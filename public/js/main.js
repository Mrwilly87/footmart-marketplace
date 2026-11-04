(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var store = window.FOOTMART || { whatsapp: "", name: "FootMart", products: {} };

  /* ---------- cart ---------- */
  var KEY = "footmart-cart-v1";

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(function (l) { return store.products[l.id]; }) : [];
    } catch (e) { return []; }
  }

  function write(lines, rebuild) {
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch (e) {}
    render(rebuild);
  }

  function count() {
    return read().reduce(function (sum, line) { return sum + line.qty; }, 0);
  }

  function add(id, qty) {
    var lines = read();
    var hit = null;
    for (var i = 0; i < lines.length; i += 1) if (lines[i].id === id) hit = lines[i];
    if (hit) hit.qty = Math.min(99, hit.qty + qty);
    else lines.push({ id: id, qty: qty, size: "" });
    write(lines);
  }

  function setQty(id, qty) {
    var lines = read().map(function (l) {
      if (l.id === id) l.qty = Math.max(1, Math.min(99, qty));
      return l;
    });
    write(lines);
  }

  function setSize(id, size) {
    var lines = read().map(function (l) { if (l.id === id) l.size = size; return l; });
    write(lines, false);
  }

  function remove(id) {
    write(read().filter(function (l) { return l.id !== id; }));
  }

  function money(item) {
    return item.price ? "KSh " + Number(item.price).toLocaleString("en-KE") : "price on request";
  }

  /* ---------- drawer ---------- */
  var drawer = document.getElementById("cart-drawer");
  var panel = document.getElementById("cart-panel");
  var listEl = document.getElementById("cart-lines");
  var totalEl = document.getElementById("cart-total");
  var noteEl = document.getElementById("cart-note");
  var placeOrderEl = document.getElementById("cart-place-order");
  var emptyEl = document.getElementById("cart-empty");
  var checkoutModal = document.getElementById("checkout-modal");
  var chatbot = document.getElementById("chatbot");

  function openCart() {
    if (!drawer) return;
    closeChat();
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("cart-locked");
    var first = panel && panel.querySelector("button, a, input");
    if (first) first.focus();
  }

  function closeCart() {
    if (!drawer) return;
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("cart-locked");
  }

  function openCheckout() {
    if (!checkoutModal) return;
    if (!read().length) return;
    closeChat();
    checkoutModal.classList.add("is-open");
    checkoutModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("cart-locked");
    renderOrderSummary();
    var firstField = document.querySelector("#checkout-form input:not(:disabled)");
    if (firstField) firstField.focus();
  }

  function renderOrderSummary() {
    var summaryList = document.getElementById("summary-list");
    if (!summaryList) return;
    var lines = read();
    var subtotal = 0;
    var hasUnknownPrice = false;
    var totalCount = 0;
    var location = document.querySelector("[name='delivery_location']");
    var isNairobi = location && /nairobi/i.test(location.value);
    var threshold = Number(store.free_delivery_threshold || 3500);
    var deliveryFee = Number(store.delivery_fee || 350);
    summaryList.textContent = "";
    lines.forEach(function (line) {
      var item = store.products[line.id];
      if (!item) return;
      totalCount += line.qty;
      if (item.price === null || item.price === undefined || item.price === "") {
        hasUnknownPrice = true;
      } else {
        subtotal += Number(item.price) * line.qty;
      }

      var row = document.createElement("div");
      row.className = "summary-row";
      var description = document.createElement("span");
      description.textContent = item.name + " × " + line.qty + (line.size ? " · size " + line.size : "");
      var price = document.createElement("strong");
      price.textContent = item.price ? "KSh " + (Number(item.price) * line.qty).toLocaleString("en-KE") : "Price on request";
      row.appendChild(description);
      row.appendChild(price);
      summaryList.appendChild(row);
    });

    delivery = isNairobi && subtotal > threshold ? 0 : deliveryFee;
    var countEl = document.getElementById("summary-count");
    var emptyEl = document.getElementById("summary-empty");
    var subtotalEl = document.getElementById("summary-subtotal");
    var deliveryEl = document.getElementById("summary-delivery");
    var totalEl = document.getElementById("summary-total");
    var hintEl = document.getElementById("delivery-hint");
    if (countEl) countEl.textContent = totalCount + " item" + (totalCount === 1 ? "" : "s");
    if (emptyEl) emptyEl.hidden = lines.length > 0;
    if (subtotalEl) subtotalEl.textContent = hasUnknownPrice ? "Confirm price" : "KSh " + subtotal.toLocaleString("en-KE");
    if (deliveryEl) deliveryEl.textContent = delivery ? "KSh " + delivery.toLocaleString("en-KE") : "Free";
    if (totalEl) totalEl.textContent = hasUnknownPrice ? "Confirm total" : "KSh " + (subtotal + delivery).toLocaleString("en-KE");
    if (hintEl) {
      hintEl.textContent = isNairobi
        ? "Free Nairobi delivery on orders above KSh " + threshold.toLocaleString("en-KE") + "."
        : "Enter a Nairobi location to check eligibility for free delivery.";
    }
  }

  function closeCheckout() {
    if (!checkoutModal) return;
    checkoutModal.classList.remove("is-open");
    checkoutModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("cart-locked");
  }

  function openChat() {
    if (!chatbot) return;
    closeCart();
    closeCheckout();
    chatbot.classList.add("is-open");
    chatbot.setAttribute("aria-hidden", "false");
  }

  function closeChat() {
    if (!chatbot) return;
    chatbot.classList.remove("is-open");
    chatbot.setAttribute("aria-hidden", "true");
  }

  function orderUrl(details) {
    var lines = read();
    var msg = "Hello " + store.name + ", I would like to order:\n";
    var subtotal = 0;
    var hasUnknownPrice = false;
    lines.forEach(function (line, i) {
      var item = store.products[line.id];
      msg += (i + 1) + ". " + item.name;
      if (item.code) msg += " (" + item.code + ")";
      msg += " x" + line.qty;
      if (line.size) msg += " — size " + line.size;
      msg += " — " + money(item) + "\n";
      if (item.price === null || item.price === undefined || item.price === "") {
        hasUnknownPrice = true;
      } else {
        subtotal += Number(item.price) * line.qty;
      }
    });
    if (details) {
      var threshold = Number(store.free_delivery_threshold || 3500);
      var delivery = /nairobi/i.test(details.location) && subtotal > threshold ? 0 : Number(store.delivery_fee || 350);
      msg += "\nCustomer: " + details.name;
      msg += "\nPhone: " + details.phone;
      msg += "\nDelivery location: " + details.location;
      if (details.note) msg += "\nDelivery note: " + details.note;
      msg += "\nPayment preference: " + details.payment;
      msg += "\nSubtotal: " + (hasUnknownPrice ? "Confirm price" : "KSh " + subtotal.toLocaleString("en-KE"));
      msg += "\nDelivery: " + (delivery ? "KSh " + delivery.toLocaleString("en-KE") : "Free");
      msg += "\nEstimated total: " + (hasUnknownPrice ? "Confirm total" : "KSh " + (subtotal + delivery).toLocaleString("en-KE"));
    } else {
      msg += "\nTotal: " + count() + " item" + (count() === 1 ? "" : "s") + ". Please confirm stock and delivery.";
    }
    return "https://wa.me/" + store.whatsapp + "?text=" + encodeURIComponent(msg);
  }

  function render(rebuild) {
    var lines = read();
    var badges = document.querySelectorAll("[data-cart-count]");
    var total = count();
    Array.prototype.forEach.call(badges, function (b) {
      b.textContent = total;
      b.classList.toggle("is-empty", total === 0);
    });

    if (!listEl) return;

    // Rebuilding the list would destroy a size input mid-edit, so a size change
    // persists and refreshes the totals only.
    if (rebuild !== false) {
      listEl.innerHTML = "";
      listEl.hidden = lines.length === 0;
      if (emptyEl) emptyEl.hidden = lines.length > 0;

      lines.forEach(function (line) {
        var item = store.products[line.id];
        var id = line.id;
        var li = document.createElement("li");
        li.className = "cart-line";

        var img = document.createElement("img");
        img.src = "/img/thumb_" + item.images[0];
        img.alt = item.name;
        img.width = 64;
        img.height = 64;
        img.loading = "lazy";

        var body = document.createElement("div");
        body.className = "cart-line-body";

        var name = document.createElement("a");
        name.className = "cart-line-name";
        name.href = "/product/" + id;
        name.textContent = item.name;

        var meta = document.createElement("p");
        meta.className = "cart-line-meta";
        meta.textContent = money(item);

        var stepper = document.createElement("div");
        stepper.className = "stepper";
        var minus = document.createElement("button");
        minus.type = "button";
        minus.className = "stepper-btn";
        minus.setAttribute("aria-label", "Decrease quantity of " + item.name);
        minus.textContent = "−";
        var qty = document.createElement("span");
        qty.className = "stepper-qty";
        qty.textContent = line.qty;
        var plus = document.createElement("button");
        plus.type = "button";
        plus.className = "stepper-btn";
        plus.setAttribute("aria-label", "Increase quantity of " + item.name);
        plus.textContent = "+";
        minus.addEventListener("click", function () {
          line.qty > 1 ? setQty(id, line.qty - 1) : remove(id);
        });
        plus.addEventListener("click", function () { setQty(id, line.qty + 1); });
        stepper.appendChild(minus);
        stepper.appendChild(qty);
        stepper.appendChild(plus);

        var size = document.createElement("input");
        size.className = "cart-size";
        size.type = "text";
        size.inputMode = "numeric";
        size.placeholder = item.sizes ? "Size (" + item.sizes + ")" : "Size";
        size.setAttribute("aria-label", "Shoe size for " + item.name);
        size.value = line.size || "";
        size.addEventListener("change", function () { setSize(id, size.value.trim()); });

        var del = document.createElement("button");
        del.type = "button";
        del.className = "cart-remove";
        del.setAttribute("aria-label", "Remove " + item.name);
        del.textContent = "✕";
        del.addEventListener("click", function () { remove(id); });

        body.appendChild(name);
        body.appendChild(meta);
        body.appendChild(stepper);
        body.appendChild(size);

        li.appendChild(img);
        li.appendChild(body);
        li.appendChild(del);
        listEl.appendChild(li);
      });
    }

    if (totalEl) {
      var cartSubtotal = 0;
      var unknownPrice = false;
      lines.forEach(function (line) {
        var item = store.products[line.id];
        if (item.price === null || item.price === undefined || item.price === "") unknownPrice = true;
        else cartSubtotal += Number(item.price) * line.qty;
      });
      totalEl.textContent = total
        ? total + " item" + (total === 1 ? "" : "s") + " · " + (unknownPrice ? "Confirm price" : "Subtotal: KSh " + cartSubtotal.toLocaleString("en-KE"))
        : "";
    }

    if (placeOrderEl) {
      placeOrderEl.disabled = !store.whatsapp || lines.length === 0;
      placeOrderEl.classList.toggle("is-off", lines.length === 0);
      placeOrderEl.classList.toggle("is-disabled", !store.whatsapp);
      placeOrderEl.textContent = store.whatsapp ? "Place order" : "WhatsApp orders unavailable";
    }
    if (noteEl) noteEl.hidden = Boolean(store.whatsapp);
  }

  /* ---------- triggers ---------- */
  document.addEventListener("click", function (event) {
    var opener = event.target.closest("[data-cart-open]");
    if (opener) { event.preventDefault(); openCart(); return; }

    var closer = event.target.closest("[data-cart-close]");
    if (closer) { event.preventDefault(); closeCart(); return; }

    var checkoutOpener = event.target.closest("#cart-place-order");
    if (checkoutOpener) {
      event.preventDefault();
      if (checkoutOpener.classList.contains("is-disabled")) return;
      closeCart();
      openCheckout();
      return;
    }

    var checkoutCloser = event.target.closest("[data-checkout-close]");
    if (checkoutCloser) { event.preventDefault(); closeCheckout(); return; }

    var chatbotOpen = event.target.closest("[data-chat-open]");
    if (chatbotOpen) { event.preventDefault(); openChat(); return; }

    var chatbotClose = event.target.closest("[data-chat-close]");
    if (chatbotClose) { event.preventDefault(); closeChat(); return; }

    var paymentChoice = event.target.closest(".payment-option");
    if (paymentChoice) {
      var parent = paymentChoice.parentNode;
      if (parent) {
        Array.prototype.forEach.call(parent.querySelectorAll(".payment-option"), function (option) {
          option.classList.toggle("is-selected", option === paymentChoice);
          var radio = option.querySelector("input[type='radio']");
          if (radio) radio.checked = option === paymentChoice;
        });
      }
      return;
    }

    var adder = event.target.closest("[data-add-to-cart]");
    if (adder) {
      event.preventDefault();
      var id = adder.getAttribute("data-add-to-cart");
      var qtyInput = document.getElementById("buy-qty");
      add(id, qtyInput ? parseInt(qtyInput.textContent, 10) || 1 : 1);
      adder.classList.add("is-done");
      var label = adder.querySelector(".add-label");
      if (label) {
        var original = label.textContent;
        label.textContent = "Added to cart";
        window.setTimeout(function () { label.textContent = original; adder.classList.remove("is-done"); }, 1400);
      }
      openCart();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeCart();
      closeCheckout();
      closeChat();
    }
  });

  var checkoutForm = document.getElementById("checkout-form");
  if (checkoutForm) {
    checkoutForm.addEventListener("input", renderOrderSummary);
    checkoutForm.addEventListener("change", renderOrderSummary);
    checkoutForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!store.whatsapp) {
        var status = document.getElementById("checkout-status");
        if (status) status.textContent = "Order requests are unavailable until a WhatsApp number is configured.";
        return;
      }

      var formData = new FormData(checkoutForm);
      var details = {
        name: String(formData.get("customer_name") || "").trim(),
        phone: String(formData.get("customer_phone") || "").trim(),
        location: String(formData.get("delivery_location") || "").trim(),
        note: String(formData.get("delivery_note") || "").trim(),
        payment: String(formData.get("payment") || "Cash on delivery")
      };
      var newWindow = window.open(orderUrl(details), "_blank");
      if (newWindow) {
        newWindow.opener = null;
        closeCheckout();
      } else {
        var statusMessage = document.getElementById("checkout-status");
        if (statusMessage) statusMessage.textContent = "WhatsApp did not open. Allow pop-ups and try again.";
      }
    });
  }

  var addressSelect = document.getElementById("checkout-address");
  if (addressSelect) {
    addressSelect.addEventListener("change", function () {
      var option = addressSelect.options[addressSelect.selectedIndex];
      if (!option || !option.value) return;
      var values = {
        customer_name: option.getAttribute("data-name"),
        customer_phone: option.getAttribute("data-phone"),
        delivery_location: option.getAttribute("data-location"),
        delivery_note: option.getAttribute("data-note")
      };
      Object.keys(values).forEach(function (name) {
        var field = checkoutForm.querySelector("[name='" + name + "']");
        if (field) field.value = values[name] || "";
      });
      renderOrderSummary();
    });
  }

  var sortSelect = document.getElementById("product-sort");
  var productGrid = document.querySelector("#catalogue .grid");
  if (sortSelect && productGrid) {
    var productCards = Array.prototype.slice.call(productGrid.querySelectorAll("[data-product-card]"));
    productCards.forEach(function (card, index) { card.setAttribute("data-original-index", index); });
    sortSelect.addEventListener("change", function () {
      var mode = sortSelect.value;
      var sorted = productCards.slice().sort(function (a, b) {
        if (mode === "price-low" || mode === "price-high") {
          var priceA = Number(a.getAttribute("data-price"));
          var priceB = Number(b.getAttribute("data-price"));
          if (!priceA && priceB) return 1;
          if (priceA && !priceB) return -1;
          var difference = priceA - priceB;
          return mode === "price-low" ? difference : -difference;
        }
        if (mode === "name") return a.getAttribute("data-name").localeCompare(b.getAttribute("data-name"));
        return Number(a.getAttribute("data-original-index")) - Number(b.getAttribute("data-original-index"));
      });
      sorted.forEach(function (card) { productGrid.appendChild(card); });
    });
  }

  var chatbotBody = document.getElementById("chatbot-body");
  function addChatBubble(kind, message) {
    if (!chatbotBody) return;
    var bubble = document.createElement("div");
    bubble.className = "chat-bubble " + kind;
    bubble.textContent = message;
    chatbotBody.appendChild(bubble);
    chatbotBody.scrollTop = chatbotBody.scrollHeight;
  }

  function chatbotReply(question) {
    var text = question.toLowerCase();
    if (text.indexOf("size") !== -1 || text.indexOf("fit") !== -1) {
      var available = Object.keys(store.products).map(function (id) {
        var item = store.products[id];
        return item.sizes ? item.name + " (" + item.sizes + ")" : "";
      }).filter(Boolean).slice(0, 3);
      return available.length
        ? "Size ranges vary by style. Examples: " + available.join("; ") + ". Check the product page or ask us to confirm a specific size."
        : "Please check the sizes shown on each product page or message us to confirm a specific fit.";
    }
    if (text.indexOf("deliver") !== -1 || text.indexOf("ship") !== -1) {
      return "Delivery is available in Nairobi and other locations by arrangement. Nairobi orders above KSh " + Number(store.free_delivery_threshold || 3500).toLocaleString("en-KE") + " qualify for free delivery; otherwise the standard fee is KSh " + Number(store.delivery_fee || 350).toLocaleString("en-KE") + ".";
    }
    if (text.indexOf("pay") !== -1 || text.indexOf("mpesa") !== -1 || text.indexOf("m-pesa") !== -1) {
      return "You can choose cash on delivery or M-Pesa. M-Pesa instructions are confirmed after you send the order request; payments are not collected on this website.";
    }
    var words = text.split(/\s+/).filter(function (word) { return word.length > 2; });
    var matches = Object.keys(store.products).map(function (id) { return store.products[id]; }).filter(function (item) {
      return words.some(function (word) { return item.name.toLowerCase().indexOf(word) !== -1; });
    }).slice(0, 3);
    if (matches.length) {
      return "You may be interested in " + matches.map(function (item) { return item.name + " — " + money(item); }).join("; ") + ". Use search to view the full product details.";
    }
    return "I can help with sizes, delivery, payment methods, or product availability. For a specific order question, please contact the store through WhatsApp.";
  }

  function askChat(question) {
    var trimmed = question.trim();
    if (!trimmed) return;
    addChatBubble("user", trimmed);
    addChatBubble("bot", chatbotReply(trimmed));
  }

  var chatbotForm = document.getElementById("chatbot-form");
  if (chatbotForm) {
    chatbotForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var input = document.getElementById("chatbot-input");
      if (!input) return;
      askChat(input.value);
      input.value = "";
      input.focus();
    });
  }

  document.querySelectorAll("[data-chat-question]").forEach(function (button) {
    button.addEventListener("click", function () { askChat(button.getAttribute("data-chat-question") || ""); });
  });

  /* ---------- header, nav, scenes, gallery, reveals ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("cat-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  var announce = document.getElementById("announce");
  var announceClose = announce && announce.querySelector(".announce-close");
  if (announceClose) {
    try { if (localStorage.getItem("footmart-announce") === "off") announce.classList.add("is-hidden"); } catch (e) {}
    announceClose.addEventListener("click", function () {
      announce.classList.add("is-hidden");
      try { localStorage.setItem("footmart-announce", "off"); } catch (e) {}
    });
  }

  var header = document.getElementById("site-header");
  if (header && "IntersectionObserver" in window) {
    var sentinel = document.createElement("div");
    sentinel.style.height = "1px";
    if (announce) announce.after(sentinel); else header.before(sentinel);
    new IntersectionObserver(function (entries) {
      header.classList.toggle("is-compact", !entries[0].isIntersecting);
    }, { threshold: 0 }).observe(sentinel);
  }

  var scenes = Array.prototype.slice.call(document.querySelectorAll(".scene"));
  var swatches = Array.prototype.slice.call(document.querySelectorAll(".scene-swatch"));
  if (scenes.length && swatches.length) {
    swatches.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var name = btn.getAttribute("data-scene");
        document.documentElement.setAttribute("data-scene", name);
        scenes.forEach(function (layer) {
          layer.classList.toggle("is-on", layer.getAttribute("data-scene") === name);
        });
        swatches.forEach(function (other) {
          other.setAttribute("aria-pressed", other === btn ? "true" : "false");
        });
      });
    });
  }

  var main = document.getElementById("gallery-main");
  var thumbs = Array.prototype.slice.call(document.querySelectorAll(".thumb"));
  if (main && thumbs.length) {
    thumbs.forEach(function (btn, index) {
      btn.setAttribute("aria-pressed", index === 0 ? "true" : "false");
      btn.addEventListener("click", function () {
        if (!reduce) main.style.opacity = "0";
        window.setTimeout(function () {
          main.src = btn.getAttribute("data-full");
          main.style.opacity = "1";
        }, reduce ? 0 : 140);
        thumbs.forEach(function (other) {
          other.setAttribute("aria-pressed", other === btn ? "true" : "false");
        });
      });
    });
  }

  var qtyBox = document.getElementById("buy-qty");
  if (qtyBox) {
    var dec = document.getElementById("qty-dec");
    var inc = document.getElementById("qty-inc");
    if (dec) dec.addEventListener("click", function () {
      qtyBox.textContent = Math.max(1, (parseInt(qtyBox.textContent, 10) || 1) - 1);
    });
    if (inc) inc.addEventListener("click", function () {
      qtyBox.textContent = Math.min(99, (parseInt(qtyBox.textContent, 10) || 1) + 1);
    });
  }

  var revealables = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  if (!revealables.length) { render(); return; }
  if (reduce || !("IntersectionObserver" in window)) {
    revealables.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
    revealables.forEach(function (el, index) {
      el.style.transitionDelay = Math.min(index, 12) * 45 + "ms";
      observer.observe(el);
    });
  }

  render();
})();
