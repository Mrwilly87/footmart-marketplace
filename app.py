import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
from contextlib import closing
from functools import wraps
from urllib.parse import urlsplit

from authlib.integrations.flask_client import OAuth
from authlib.integrations.base_client.errors import OAuthError
from authlib.jose.errors import JoseError
from authlib.oauth2.rfc6749.errors import OAuth2Error
from flask import Flask, abort, flash, g, jsonify, redirect, render_template, request, session, url_for
from requests.exceptions import RequestException
from werkzeug.security import check_password_hash, generate_password_hash

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:
    psycopg = None
    dict_row = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(
    __name__,
    static_folder=os.path.join(BASE_DIR, "public"),
    static_url_path="",
)
app.config["TEMPLATES_AUTO_RELOAD"] = True
is_vercel = os.environ.get("VERCEL") == "1"
if not is_vercel:
    os.makedirs(app.instance_path, exist_ok=True)

secret_key = os.environ.get("FOOTMART_SECRET_KEY")
if not secret_key and is_vercel:
    raise RuntimeError("FOOTMART_SECRET_KEY must be configured in Vercel environment variables.")
secret_path = os.path.join(app.instance_path, "secret_key")
if not secret_key:
    os.makedirs(app.instance_path, exist_ok=True)
    if os.path.exists(secret_path):
        with open(secret_path, encoding="utf-8") as secret_file:
            secret_key = secret_file.read().strip()
    else:
        generated_key = secrets.token_hex(32)
        try:
            with open(secret_path, "x", encoding="utf-8") as secret_file:
                secret_file.write(generated_key)
            secret_key = generated_key
        except FileExistsError:
            with open(secret_path, encoding="utf-8") as secret_file:
                secret_key = secret_file.read().strip()

app.config.update(
    SECRET_KEY=secret_key,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=(
        os.environ.get("FOOTMART_COOKIE_SECURE") == "1"
        or os.environ.get("VERCEL") == "1"
        or os.environ.get("FLASK_ENV") == "production"
    ),
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 14,
)

CATALOG_PATH = os.path.join(BASE_DIR, "data", "catalog.json")
DATABASE_PATH = os.environ.get(
    "FOOTMART_DATABASE_PATH",
    os.path.join(app.instance_path, "footmart.sqlite3"),
)
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
if is_vercel and not DATABASE_URL:
    raise RuntimeError("DATABASE_URL must point to a persistent PostgreSQL database on Vercel.")
if DATABASE_URL and psycopg is None:
    raise RuntimeError("Install the psycopg[binary] dependency to use DATABASE_URL.")
if not DATABASE_URL:
    os.makedirs(os.path.dirname(os.path.abspath(DATABASE_PATH)), exist_ok=True)
_cache = {"mtime": None, "data": {}}
logger = logging.getLogger(__name__)


class PostgresConnection:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, query, parameters=()):
        return self.connection.execute(query.replace("?", "%s"), parameters)

    def commit(self):
        self.connection.commit()

    def rollback(self):
        self.connection.rollback()

    def close(self):
        self.connection.close()


INTEGRITY_ERRORS = (sqlite3.IntegrityError,) + (
    (psycopg.IntegrityError,) if psycopg is not None else ()
)

oauth = OAuth(app)
google_enabled = bool(
    os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET")
)
google_redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI")
if google_enabled:
    oauth.register(
        name="google",
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )

ADMIN_EMAIL = (
    os.environ.get("ADMIN_EMAIL") or os.environ.get("EMAIL_LOG_IN", "")
).strip().lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or os.environ.get("LOG_IN_PASS", "")
ADMIN_STATUSES = (
    "awaiting_whatsapp",
    "confirmed",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
)


def get_db():
    if "db" not in g:
        if DATABASE_URL:
            database_url = DATABASE_URL
            if database_url.startswith("postgres://"):
                database_url = "postgresql://" + database_url[len("postgres://") :]
            g.db = PostgresConnection(
                psycopg.connect(database_url, row_factory=dict_row)
            )
        else:
            g.db = sqlite3.connect(DATABASE_PATH)
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def init_db():
    if DATABASE_URL:
        database_url = DATABASE_URL
        if database_url.startswith("postgres://"):
            database_url = "postgresql://" + database_url[len("postgres://") :]
        with psycopg.connect(database_url) as db:
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id BIGSERIAL PRIMARY KEY,
                    full_name TEXT NOT NULL,
                    phone TEXT UNIQUE,
                    email TEXT UNIQUE,
                    password_hash TEXT,
                    google_sub TEXT UNIQUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            db.execute("ALTER TABLE users ALTER COLUMN phone DROP NOT NULL")
            db.execute("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL")
            db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE")
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS addresses (
                    id BIGSERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    label TEXT NOT NULL,
                    recipient_name TEXT NOT NULL,
                    phone TEXT NOT NULL,
                    location TEXT NOT NULL,
                    delivery_note TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS reviews (
                    id BIGSERIAL PRIMARY KEY,
                    product_id TEXT NOT NULL,
                    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                    review_text TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (product_id, user_id)
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS orders (
                    id BIGSERIAL PRIMARY KEY,
                    tracking_code TEXT NOT NULL UNIQUE,
                    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
                    customer_name TEXT NOT NULL,
                    customer_phone TEXT NOT NULL,
                    delivery_location TEXT NOT NULL,
                    delivery_note TEXT NOT NULL DEFAULT '',
                    payment_method TEXT NOT NULL,
                    items_json TEXT NOT NULL,
                    item_count INTEGER NOT NULL,
                    subtotal NUMERIC,
                    delivery_fee NUMERIC NOT NULL,
                    total NUMERIC,
                    status TEXT NOT NULL DEFAULT 'awaiting_whatsapp',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        return

    with closing(sqlite3.connect(DATABASE_PATH)) as db, db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = OFF")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                phone TEXT UNIQUE,
                email TEXT UNIQUE,
                password_hash TEXT,
                google_sub TEXT UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        columns = {
            row["name"]: row
            for row in db.execute("PRAGMA table_info(users)").fetchall()
        }
        phone_is_required = bool(columns.get("phone") and columns["phone"]["notnull"])
        if phone_is_required or "google_sub" not in columns:
            google_sub_expr = "google_sub" if "google_sub" in columns else "NULL"
            db.execute(
                """
                CREATE TABLE users_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    full_name TEXT NOT NULL,
                    phone TEXT UNIQUE,
                    email TEXT UNIQUE,
                    password_hash TEXT,
                    google_sub TEXT UNIQUE,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            db.execute(
                """
                INSERT INTO users_new
                    (id, full_name, phone, email, password_hash, google_sub, created_at)
                SELECT id, full_name, phone, email, password_hash, {google_sub}, created_at
                FROM users
                """.format(google_sub=google_sub_expr)
            )
            db.execute("DROP TABLE users")
            db.execute("ALTER TABLE users_new RENAME TO users")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS addresses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                label TEXT NOT NULL,
                recipient_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                location TEXT NOT NULL,
                delivery_note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id TEXT NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                review_text TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (product_id, user_id)
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tracking_code TEXT NOT NULL UNIQUE,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                customer_name TEXT NOT NULL,
                customer_phone TEXT NOT NULL,
                delivery_location TEXT NOT NULL,
                delivery_note TEXT NOT NULL DEFAULT '',
                payment_method TEXT NOT NULL,
                items_json TEXT NOT NULL,
                item_count INTEGER NOT NULL,
                subtotal REAL,
                delivery_fee REAL NOT NULL,
                total REAL,
                status TEXT NOT NULL DEFAULT 'awaiting_whatsapp',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        db.execute("PRAGMA foreign_keys = ON")


@app.teardown_appcontext
def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def normalize_phone(value):
    digits = re.sub(r"\D", "", value or "")
    if digits.startswith("00"):
        digits = digits[2:]
    elif len(digits) == 10 and digits.startswith("0"):
        digits = "254" + digits[1:]
    elif len(digits) == 9:
        digits = "254" + digits
    return digits if 7 <= len(digits) <= 15 else ""


def csrf_token():
    if "_csrf_token" not in session:
        session["_csrf_token"] = secrets.token_urlsafe(32)
    return session["_csrf_token"]


def valid_csrf():
    provided = request.form.get("csrf_token", "") or request.headers.get("X-CSRF-Token", "")
    expected = session.get("_csrf_token", "")
    return bool(expected and provided and secrets.compare_digest(expected, provided))


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if not session.get("user_id"):
            return redirect(url_for("login", next=request.full_path))
        return view(*args, **kwargs)

    return wrapped_view


def admin_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if (
            session.get("is_admin") is not True
            or not ADMIN_EMAIL
            or not ADMIN_PASSWORD
            or not secrets.compare_digest(
                session.get("admin_auth_fingerprint", ""),
                admin_auth_fingerprint(),
            )
        ):
            return redirect(url_for("admin_login", next=request.path))
        return view(*args, **kwargs)

    return wrapped_view


def admin_auth_fingerprint():
    credentials = f"{ADMIN_EMAIL}\0{ADMIN_PASSWORD}".encode("utf-8")
    key = app.config["SECRET_KEY"].encode("utf-8")
    return hmac.new(key, credentials, hashlib.sha256).hexdigest()


def safe_next_url(target):
    if not target:
        return None
    parsed = urlsplit(target)
    if (
        parsed.scheme
        or parsed.netloc
        or "\\" in target
        or any(ord(char) < 32 for char in target)
        or not target.startswith("/")
        or target.startswith("//")
    ):
        return None
    return target


init_db()


def catalog():
    mtime = os.path.getmtime(CATALOG_PATH)
    if _cache["mtime"] != mtime:
        with open(CATALOG_PATH, encoding="utf-8") as fh:
            _cache["data"] = json.load(fh)
        _cache["mtime"] = mtime
    return _cache["data"]


def site():
    return catalog().get("site", {})


def products():
    return catalog().get("products", [])


def categories():
    seen = {}
    for item in products():
        slug = item.get("category", "other")
        if slug not in seen:
            seen[slug] = {"slug": slug, "label": item.get("category_label", slug), "count": 0}
        seen[slug]["count"] += 1
    return sorted(seen.values(), key=lambda c: c["label"])


def find(product_id):
    for item in products():
        if item["id"] == product_id:
            return item
    return None


def price_text(item):
    value = item.get("price")
    if value in (None, "", 0):
        return "Price on request"
    return "KSh {:,.0f}".format(float(value))


def size_options(item):
    value = str(item.get("sizes", "")).strip()
    match = re.fullmatch(r"(\d+)\s*[-–]\s*(\d+)", value)
    if not match:
        return []
    first, last = map(int, match.groups())
    return [str(size) for size in range(first, last + 1)] if first <= last else []


app.jinja_env.filters["price_text"] = price_text


@app.context_processor
def storefront():
    saved_addresses = []
    current_user = getattr(g, "current_user", None)
    if current_user:
        saved_addresses = get_db().execute(
            "SELECT id, label, recipient_name, phone, location, delivery_note "
            "FROM addresses WHERE user_id = ? ORDER BY id DESC",
            (current_user["id"],),
        ).fetchall()
    return {
        "current_user": current_user,
        "saved_addresses": saved_addresses,
        "csrf_token": csrf_token(),
        "storefront": {
            "name": site().get("name", "Shop"),
            "whatsapp": site().get("whatsapp", ""),
            "delivery_fee": site().get("delivery_fee", 350),
            "free_delivery_threshold": site().get("free_delivery_threshold", 3500),
            "authenticated": current_user is not None,
            "products": {
                item["id"]: {
                    "name": item["name"],
                    "code": item.get("code", ""),
                    "sizes": item.get("sizes", ""),
                    "size_options": size_options(item),
                    "price": item.get("price"),
                    "images": item["images"],
                }
                for item in products()
            },
            "csrf_token": csrf_token(),
        }
    }


@app.before_request
def load_current_user():
    user_id = session.get("user_id")
    g.current_user = None
    if user_id:
        g.current_user = get_db().execute(
            "SELECT id, full_name, phone, email, google_sub, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if g.current_user is None:
            session.clear()


def category_tiles():
    tiles = []
    for cat in categories():
        first = next(item for item in products() if item.get("category") == cat["slug"])
        tiles.append(
            {
                "slug": cat["slug"],
                "label": cat["label"],
                "count": cat["count"],
                "image": first["images"][0],
            }
        )
    return tiles


def featured_product():
    wanted = site().get("featured")
    items = products()
    if wanted:
        match = find(wanted)
        if match:
            return match
    return items[0] if items else None


@app.route("/")
def index():
    query = request.args.get("q", "").strip().lower()
    category = request.args.get("cat", "").strip()
    visible = [
        item
        for item in products()
        if (not category or item.get("category") == category)
        and (
            not query
            or query in item["name"].lower()
            or query in item.get("code", "").lower()
            or query in item.get("description", "").lower()
        )
    ]
    browsing_all = not query and not category
    return render_template(
        "index.html",
        site=site(),
        products=visible,
        categories=categories(),
        query=request.args.get("q", "").strip(),
        active_category=category,
        total=len(products()),
        featured=featured_product() if browsing_all else None,
        category_tiles=category_tiles() if browsing_all else [],
        just_landed=products()[-10:][::-1] if browsing_all else [],
    )


@app.route("/product/<product_id>")
def product_page(product_id):
    item = find(product_id)
    if item is None:
        abort(404)
    review_summary = get_db().execute(
        "SELECT COUNT(*) AS count, AVG(rating) AS average FROM reviews WHERE product_id = ?",
        (product_id,),
    ).fetchone()
    reviews = get_db().execute(
        "SELECT reviews.rating, reviews.review_text, reviews.created_at, users.full_name "
        "FROM reviews JOIN users ON users.id = reviews.user_id "
        "WHERE reviews.product_id = ? ORDER BY reviews.created_at DESC LIMIT 50",
        (product_id,),
    ).fetchall()
    user_review = None
    if g.current_user:
        user_review = get_db().execute(
            "SELECT rating, review_text FROM reviews WHERE product_id = ? AND user_id = ?",
            (product_id, g.current_user["id"]),
        ).fetchone()
    related = [
        other
        for other in products()
        if other["id"] != item["id"] and other.get("category") == item.get("category")
    ][:4]
    return render_template(
        "product.html",
        site=site(),
        product=item,
        size_options=size_options(item),
        review_count=review_summary["count"],
        review_average=review_summary["average"],
        reviews=reviews,
        user_review=user_review,
        related=related,
        categories=categories(),
    )


@app.route("/product/<product_id>/reviews", methods=["POST"])
@login_required
def submit_review(product_id):
    if find(product_id) is None:
        abort(404)
    if not valid_csrf():
        abort(400, description="Invalid form token. Refresh the page and try again.")
    rating_value = request.form.get("rating", "")
    review_text = request.form.get("review_text", "").strip()
    if rating_value not in {"1", "2", "3", "4", "5"}:
        flash("Choose a rating from 1 to 5 stars.", "error")
    elif len(review_text) < 3 or len(review_text) > 1000:
        flash("Write a review between 3 and 1,000 characters.", "error")
    else:
        db = get_db()
        db.execute(
            """
            INSERT INTO reviews (product_id, user_id, rating, review_text)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (product_id, user_id) DO UPDATE
            SET rating = excluded.rating, review_text = excluded.review_text
            """,
            (product_id, g.current_user["id"], int(rating_value), review_text),
        )
        db.commit()
        flash("Your product review has been saved.", "success")
    return redirect(url_for("product_page", product_id=product_id) + "#reviews")


@app.route("/orders", methods=["POST"])
def create_order():
    if not g.current_user:
        return jsonify(
            error="Sign in or create an account to place your order.",
            sign_in_url=url_for("checkout"),
        ), 401
    if not valid_csrf():
        return jsonify(error="Your session expired. Refresh the page and try again."), 400
    if not site().get("whatsapp"):
        return jsonify(error="Order requests are temporarily unavailable."), 503
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Invalid order details."), 400
    name_value = payload.get("name")
    phone_value = payload.get("phone")
    location_value = payload.get("location")
    note_value = payload.get("note", "")
    if not all(isinstance(value, str) for value in (name_value, phone_value, location_value, note_value)):
        return jsonify(error="Check your name, phone number, and delivery location."), 400
    name = name_value.strip()
    phone = normalize_phone(phone_value)
    location = location_value.strip()
    note = note_value.strip()
    if (
        not name
        or len(name) > 100
        or not phone
        or not location
        or len(location) > 300
        or len(note) > 500
    ):
        return jsonify(error="Check your name, phone number, and delivery location."), 400
    if payload.get("payment") != "Cash on delivery":
        return jsonify(error="Only cash on delivery is currently available."), 400
    lines = payload.get("items")
    if not isinstance(lines, list) or not lines or len(lines) > 40:
        return jsonify(error="Your cart is empty or contains too many items."), 400

    item_snapshots = []
    subtotal = 0
    unknown_price = False
    item_count = 0
    for line in lines:
        if not isinstance(line, dict):
            return jsonify(error="One or more cart items are invalid."), 400
        item = find(str(line.get("id", "")))
        quantity = line.get("qty")
        size_value = line.get("size", "")
        if not isinstance(size_value, str):
            return jsonify(error="Check the product and size selections in your cart."), 400
        selected_size = size_value.strip()
        if (
            item is None
            or isinstance(quantity, bool)
            or not isinstance(quantity, int)
            or not 1 <= quantity <= 99
            or len(selected_size) > 20
            or (size_options(item) and selected_size not in size_options(item))
        ):
            return jsonify(error="Check the product and size selections in your cart."), 400
        price = item.get("price")
        if price in (None, ""):
            unknown_price = True
            unit_price = None
        else:
            unit_price = float(price)
            subtotal += unit_price * quantity
        item_count += quantity
        item_snapshots.append(
            {
                "id": item["id"],
                "name": item["name"],
                "code": item.get("code", ""),
                "size": selected_size,
                "qty": quantity,
                "unit_price": unit_price,
            }
        )

    delivery_fee = float(site().get("delivery_fee", 350))
    threshold = float(site().get("free_delivery_threshold", 3500))
    if re.search(r"\bnairobi\b", location, re.IGNORECASE) and subtotal > threshold:
        delivery_fee = 0
    known_subtotal = None if unknown_price else subtotal
    total = None if unknown_price else subtotal + delivery_fee
    tracking_code = secrets.token_urlsafe(18)
    db = get_db()
    db.execute(
        """
        INSERT INTO orders (
            tracking_code, user_id, customer_name, customer_phone, delivery_location,
            delivery_note, payment_method, items_json, item_count, subtotal,
            delivery_fee, total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            tracking_code,
            g.current_user["id"] if g.current_user else None,
            name,
            phone,
            location,
            note,
            "Cash on delivery",
            json.dumps(item_snapshots, separators=(",", ":")),
            item_count,
            known_subtotal,
            delivery_fee,
            total,
        ),
    )
    db.commit()
    return jsonify(
        tracking_code=tracking_code,
        tracking_url=url_for("track_order", tracking_code=tracking_code),
    ), 201


@app.route("/checkout")
def checkout():
    if not g.current_user:
        flash("Sign in or create an account to place your order. Your cart will be saved.", "info")
        return redirect(url_for("login", next=url_for("checkout")))
    return redirect(url_for("index", checkout="1"))


@app.route("/track", methods=["GET", "POST"])
def track_order_entry():
    if request.method == "POST":
        tracking_code = request.form.get("tracking_code", "").strip()
        if re.fullmatch(r"[A-Za-z0-9_-]{20,64}", tracking_code):
            return redirect(url_for("track_order", tracking_code=tracking_code))
        flash("Enter the tracking code from your order confirmation.", "error")
    return render_template("track_order_entry.html", site=site(), categories=categories())


@app.route("/track/<tracking_code>")
def track_order(tracking_code):
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,64}", tracking_code):
        abort(404)
    order = get_db().execute(
        """
        SELECT tracking_code, items_json, item_count, delivery_location,
               payment_method, status, created_at
        FROM orders WHERE tracking_code = ?
        """,
        (tracking_code,),
    ).fetchone()
    if order is None:
        abort(404)
    return render_template(
        "track_order.html",
        site=site(),
        order=order,
        order_items=json.loads(order["items_json"]),
    )


@app.route("/admin", methods=["GET"])
@admin_required
def admin_dashboard():
    orders = get_db().execute(
        """
        SELECT tracking_code, customer_name, customer_phone, delivery_location,
               delivery_note, payment_method, items_json, item_count, subtotal,
               delivery_fee, total, status, created_at
        FROM orders
        ORDER BY created_at DESC
        LIMIT 100
        """
    ).fetchall()
    order_count = get_db().execute(
        "SELECT COUNT(*) AS count FROM orders"
    ).fetchone()["count"]
    return render_template(
        "admin/dashboard.html",
        site=site(),
        categories=categories(),
        orders=[
            {**dict(order), "items": json.loads(order["items_json"])}
            for order in orders
        ],
        order_count=order_count,
        order_statuses=ADMIN_STATUSES,
    )


@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    next_url = safe_next_url(request.values.get("next"))
    if session.get("is_admin") is True:
        return redirect(next_url or url_for("admin_dashboard"))

    if request.method == "POST":
        if not valid_csrf():
            abort(400, description="Invalid form token. Refresh the page and try again.")
        if not ADMIN_EMAIL or not ADMIN_PASSWORD:
            logger.error("Admin login attempted before ADMIN_EMAIL and ADMIN_PASSWORD were configured")
            flash("Admin login is not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD in the server environment.", "error")
        else:
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            email_matches = len(email) <= 254 and secrets.compare_digest(
                email.encode("utf-8"), ADMIN_EMAIL.encode("utf-8")
            )
            password_matches = len(password) <= 256 and secrets.compare_digest(
                password.encode("utf-8"), ADMIN_PASSWORD.encode("utf-8")
            )
            if not email_matches or not password_matches:
                flash("We couldn't sign you in with those details. Check them and try again.", "error")
            else:
                session.clear()
                session["is_admin"] = True
                session["admin_auth_fingerprint"] = admin_auth_fingerprint()
                session.permanent = True
                flash("You are signed in to the admin portal.", "success")
                return redirect(next_url or url_for("admin_dashboard"))

    return render_template(
        "admin/login.html",
        site=site(),
        categories=categories(),
        next_url=next_url or "",
        admin_configured=bool(ADMIN_EMAIL and ADMIN_PASSWORD),
    )


@app.route("/admin/logout", methods=["POST"])
@admin_required
def admin_logout():
    if not valid_csrf():
        abort(400, description="Invalid form token. Refresh the page and try again.")
    session.clear()
    flash("You have been signed out of the admin portal.", "success")
    return redirect(url_for("admin_login"))


@app.route("/admin/orders/<tracking_code>/status", methods=["POST"])
@admin_required
def admin_update_order_status(tracking_code):
    if not valid_csrf():
        abort(400, description="Invalid form token. Refresh the page and try again.")
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,64}", tracking_code):
        abort(404)
    status = request.form.get("status", "")
    if status not in ADMIN_STATUSES:
        abort(400, description="Select a valid order status.")
    cursor = get_db().execute(
        "UPDATE orders SET status = ? WHERE tracking_code = ?",
        (status, tracking_code),
    )
    get_db().commit()
    if cursor.rowcount:
        flash("Order status updated.", "success")
    else:
        flash("That order could not be found.", "error")
    return redirect(url_for("admin_dashboard"))


@app.route("/account/login", methods=["GET", "POST"])
def login():
    next_url = safe_next_url(request.values.get("next"))
    if request.method == "POST":
        if not valid_csrf():
            abort(400, description="Invalid form token. Refresh the page and try again.")
        identifier = request.form.get("identifier", "").strip()
        password = request.form.get("password", "")
        phone = normalize_phone(identifier)
        user = get_db().execute(
            "SELECT id, password_hash FROM users WHERE lower(email) = ? OR phone = ?",
            (identifier.lower(), phone),
        ).fetchone()
        if (
            not user
            or not user["password_hash"]
            or len(password) > 256
            or not check_password_hash(user["password_hash"], password)
        ):
            flash("We couldn't sign you in with those details. Check them and try again.", "error")
        else:
            session.clear()
            session["user_id"] = user["id"]
            session.permanent = True
            flash("Welcome back.", "success")
            return redirect(next_url or url_for("profile"))

    return render_template(
        "account/login.html",
        site=site(),
        categories=categories(),
        next_url=next_url or "",
        google_enabled=google_enabled,
    )


@app.route("/account/google")
def google_login():
    next_url = safe_next_url(request.args.get("next"))
    if not google_enabled:
        flash("Google sign-in is not configured yet.", "error")
        return redirect(url_for("login", next=next_url or ""))
    session["google_next_url"] = next_url or ""
    google = oauth.create_client("google")
    redirect_uri = google_redirect_uri or url_for("google_callback", _external=True)
    return google.authorize_redirect(redirect_uri)


@app.route("/account/google/callback")
def google_callback():
    if not google_enabled:
        abort(404)
    next_url = safe_next_url(session.pop("google_next_url", ""))
    google = oauth.create_client("google")
    try:
        token = google.authorize_access_token()
    except (OAuthError, OAuth2Error, JoseError, RequestException):
        logger.warning("Google sign-in was not completed successfully")
        flash("Google sign-in was cancelled or could not be completed. Please try again.", "error")
        return redirect(url_for("login", next=next_url or ""))

    user_info = token.get("userinfo")
    if not user_info:
        logger.error("Google OAuth response did not contain verified OpenID user information")
        flash("Google sign-in could not verify your account. Please try again.", "error")
        return redirect(url_for("login", next=next_url or ""))

    google_sub = user_info.get("sub")
    email = str(user_info.get("email", "")).strip().lower()
    name = str(user_info.get("name", "")).strip()
    email_verified = user_info.get("email_verified") is True
    if (
        not google_sub
        or len(google_sub) > 255
        or not email_verified
        or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)
        or not name
        or len(name) > 100
    ):
        logger.warning("Google sign-in returned incomplete or unverified account claims")
        flash("Google did not provide a verified email and profile name. Please use another sign-in method.", "error")
        return redirect(url_for("login", next=next_url or ""))

    db = get_db()
    user = db.execute(
        "SELECT id FROM users WHERE google_sub = ?",
        (google_sub,),
    ).fetchone()
    if user is None:
        user = db.execute(
            "SELECT id, google_sub FROM users WHERE lower(email) = ?",
            (email,),
        ).fetchone()
        if user:
            if user["google_sub"] and user["google_sub"] != google_sub:
                flash("That email is already linked to a different Google account.", "error")
                return redirect(url_for("login", next=next_url or ""))
            try:
                db.execute(
                    "UPDATE users SET google_sub = ? WHERE id = ?",
                    (google_sub, user["id"]),
                )
                db.commit()
            except INTEGRITY_ERRORS:
                db.rollback()
                logger.warning("Google account could not be linked because its subject is already associated")
                flash("That Google account is already linked to another FootMart account.", "error")
                return redirect(url_for("login", next=next_url or ""))
        else:
            try:
                cursor = db.execute(
                    "INSERT INTO users (full_name, email, password_hash, google_sub) "
                    "VALUES (?, ?, ?, ?) RETURNING id",
                    (name, email, generate_password_hash(secrets.token_urlsafe(48)), google_sub),
                )
                user_id = cursor.fetchone()["id"]
                db.commit()
            except INTEGRITY_ERRORS:
                db.rollback()
                logger.warning("Google account could not be created because its email is already registered")
                flash("That email is already registered. Sign in with your password first to link Google.", "error")
                return redirect(url_for("login", next=next_url or ""))
            else:
                session.clear()
                session["user_id"] = user_id
                session.permanent = True
                flash("Your FootMart account is ready.", "success")
                return redirect(next_url or url_for("profile"))

    session.clear()
    session["user_id"] = user["id"]
    session.permanent = True
    flash("You are signed in with Google.", "success")
    return redirect(next_url or url_for("profile"))


@app.route("/account/register", methods=["GET", "POST"])
def register():
    next_url = safe_next_url(request.values.get("next"))
    if request.method == "POST":
        if not valid_csrf():
            abort(400, description="Invalid form token. Refresh the page and try again.")
        name = request.form.get("full_name", "").strip()
        phone = normalize_phone(request.form.get("phone", ""))
        email = request.form.get("email", "").strip().lower() or None
        password = request.form.get("password", "")
        confirmation = request.form.get("password_confirm", "")

        errors = []
        if not name or len(name) > 100:
            errors.append("Enter your name (up to 100 characters).")
        if not phone:
            errors.append("Enter a valid phone number with 7 to 15 digits.")
        if email and (len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)):
            errors.append("Enter a valid email address.")
        if len(password) < 8 or len(password) > 256:
            errors.append("Your password must be between 8 and 256 characters.")
        if password != confirmation:
            errors.append("The passwords do not match.")

        if not errors:
            try:
                cursor = get_db().execute(
                    "INSERT INTO users (full_name, phone, email, password_hash) "
                    "VALUES (?, ?, ?, ?) RETURNING id",
                    (name, phone, email, generate_password_hash(password)),
                )
                user_id = cursor.fetchone()["id"]
                get_db().commit()
            except INTEGRITY_ERRORS:
                get_db().rollback()
                errors.append("That phone number or email is already registered. Sign in instead.")
            else:
                session.clear()
                session["user_id"] = user_id
                session.permanent = True
                flash("Your FootMart account is ready.", "success")
                return redirect(next_url or url_for("profile"))

        for error in errors:
            flash(error, "error")

    return render_template(
        "account/register.html",
        site=site(),
        categories=categories(),
        next_url=next_url or "",
        google_enabled=google_enabled,
    )


@app.route("/account/logout", methods=["POST"])
@login_required
def logout():
    if not valid_csrf():
        abort(400, description="Invalid form token. Refresh the page and try again.")
    session.clear()
    flash("You have been signed out.", "success")
    return redirect(url_for("index"))


@app.route("/account/profile")
@login_required
def profile():
    addresses = get_db().execute(
        "SELECT id, label, recipient_name, phone, location, delivery_note "
        "FROM addresses WHERE user_id = ? ORDER BY id DESC",
        (g.current_user["id"],),
    ).fetchall()
    account_orders = get_db().execute(
        "SELECT tracking_code, item_count, status, created_at "
        "FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
        (g.current_user["id"],),
    ).fetchall()
    return render_template(
        "account/profile.html",
        site=site(),
        categories=categories(),
        addresses=addresses,
        account_orders=account_orders,
    )


@app.route("/account/profile/update", methods=["POST"])
@login_required
def update_profile():
    if not valid_csrf():
        abort(400, description="Invalid form token. Refresh the page and try again.")
    name = request.form.get("full_name", "").strip()
    phone = normalize_phone(request.form.get("phone", ""))
    email = request.form.get("email", "").strip().lower() or None

    if not name or len(name) > 100 or not phone:
        flash("Enter a name and a valid phone number.", "error")
    elif email and (len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)):
        flash("Enter a valid email address or leave it blank.", "error")
    else:
        try:
            get_db().execute(
                "UPDATE users SET full_name = ?, phone = ?, email = ? WHERE id = ?",
                (name, phone, email, g.current_user["id"]),
            )
            get_db().commit()
        except INTEGRITY_ERRORS:
            get_db().rollback()
            flash("That phone number or email is already used by another account.", "error")
        else:
            flash("Your profile details have been updated.", "success")
    return redirect(url_for("profile"))


@app.route("/account/addresses", methods=["POST"])
@login_required
def add_address():
    if not valid_csrf():
        abort(400, description="Invalid form token. Refresh the page and try again.")
    label = request.form.get("label", "").strip()
    name = request.form.get("recipient_name", "").strip()
    phone = normalize_phone(request.form.get("phone", ""))
    location = request.form.get("location", "").strip()
    note = request.form.get("delivery_note", "").strip()
    if not label or len(label) > 40 or not name or len(name) > 100 or not phone or not location or len(location) > 300 or len(note) > 500:
        flash("Complete the address fields with valid details and try again.", "error")
    else:
        get_db().execute(
            "INSERT INTO addresses (user_id, label, recipient_name, phone, location, delivery_note) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (g.current_user["id"], label, name, phone, location, note),
        )
        get_db().commit()
        flash("Delivery address saved.", "success")
    return redirect(url_for("profile") + "#addresses")


@app.route("/account/addresses/<int:address_id>/delete", methods=["POST"])
@login_required
def delete_address(address_id):
    if not valid_csrf():
        abort(400, description="Invalid form token. Refresh the page and try again.")
    cursor = get_db().execute(
        "DELETE FROM addresses WHERE id = ? AND user_id = ?",
        (address_id, g.current_user["id"]),
    )
    get_db().commit()
    if cursor.rowcount:
        flash("Delivery address removed.", "success")
    else:
        flash("That address could not be found.", "error")
    return redirect(url_for("profile") + "#addresses")


@app.route("/account/password", methods=["POST"])
@login_required
def change_password():
    if not valid_csrf():
        abort(400, description="Invalid form token. Refresh the page and try again.")
    current_password = request.form.get("current_password", "")
    new_password = request.form.get("new_password", "")
    confirmation = request.form.get("password_confirm", "")
    user = get_db().execute(
        "SELECT password_hash FROM users WHERE id = ?",
        (g.current_user["id"],),
    ).fetchone()
    if not check_password_hash(user["password_hash"], current_password):
        flash("Your current password is incorrect.", "error")
    elif len(new_password) < 8 or len(new_password) > 256:
        flash("Your new password must be between 8 and 256 characters.", "error")
    elif new_password != confirmation:
        flash("The new passwords do not match.", "error")
    else:
        get_db().execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (generate_password_hash(new_password), g.current_user["id"]),
        )
        get_db().commit()
        flash("Your password has been changed.", "success")
    return redirect(url_for("profile") + "#security")


@app.errorhandler(404)
def not_found(_error):
    return render_template("404.html", site=site()), 404


if __name__ == "__main__":
    app.run(debug=True, port=int(os.environ.get("PORT", 5400)))
