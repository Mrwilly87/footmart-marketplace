(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var store = window.FOOTMART || { whatsapp: "", name: "FootMart", products: {} };

  /* ---------- cart ---------- */
  var KEY = "footmart-cart-v1";
  var WISHLIST_KEY = "footmart-wishlist-v1";

  function readWishlist() {
    try {
      var saved = JSON.parse(localStorage.getItem(WISHLIST_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter(function (id) { return store.products[id]; }) : [];
    } catch (e) { return []; }
  }

  function renderWishlist() {
    var saved = readWishlist();
    document.querySelectorAll("[data-wishlist]").forEach(function (button) {
      var selected = saved.indexOf(button.getAttribute("data-wishlist")) !== -1;
      button.classList.toggle("is-saved", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.setAttribute("aria-label", (selected ? "Remove " : "Save ") + store.products[button.getAttribute("data-wishlist")].name);
    });
    document.querySelectorAll("[data-wishlist-count]").forEach(function (count) {
      count.textContent = saved.length;
    });
  }

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

  function add(id, qty, size) {
    var lines = read();
    var hit = null;
    for (var i = 0; i < lines.length; i += 1) {
      if (lines[i].id === id && (lines[i].size || "") === (size || "")) hit = lines[i];
    }
    if (hit) hit.qty = Math.min(99, hit.qty + qty);
    else lines.push({ id: id, qty: qty, size: size || "" });
    write(lines);
  }

  function setQty(id, qty) {
    var lines = read().map(function (l) {
      if (l.id === id) l.qty = Math.max(1, Math.min(99, qty));
      return l;
    });
    write(lines);
  }

  function setSize(id, previousSize, size) {
    var lines = read();
    var target = lines.find(function (line) {
      return line.id === id && (line.size || "") === previousSize;
    });
    var duplicate = lines.find(function (line) {
      return line !== target && line.id === id && (line.size || "") === size;
    });
    if (target && duplicate) {
      duplicate.qty = Math.min(99, duplicate.qty + target.qty);
      lines = lines.filter(function (line) { return line !== target; });
    } else if (target) {
      target.size = size;
    }
    write(lines);
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
    if (!store.authenticated) {
      window.location.assign("/checkout");
      return;
    }
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

    var delivery = isNairobi && subtotal > threshold ? 0 : deliveryFee;
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
    var estimateEl = document.getElementById("delivery-estimate");
    if (estimateEl) {
      estimateEl.textContent = isNairobi
        ? "Estimated delivery: usually 1–2 business days in Nairobi after confirmation. The store confirms timing."
        : location && location.value.trim()
          ? "Estimated delivery: usually 2–5 business days outside Nairobi after confirmation. The store confirms timing."
          : "Estimated delivery: usually 1–2 business days in Nairobi and 2–5 elsewhere after confirmation.";
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

  function orderUrl(details, trackingCode) {
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
      if (trackingCode) {
        msg += "\nTracking code: " + trackingCode;
        msg += "\nTrack order: " + window.location.origin + "/track/" + trackingCode;
      }
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

        var size;
        if (item.size_options && item.size_options.length) {
          size = document.createElement("select");
          size.className = "cart-size";
          var placeholder = document.createElement("option");
          placeholder.value = "";
          placeholder.textContent = "Choose size";
          size.appendChild(placeholder);
          item.size_options.forEach(function (option) {
            var choice = document.createElement("option");
            choice.value = option;
            choice.textContent = "EU " + option;
            size.appendChild(choice);
          });
          size.value = line.size || "";
        } else {
          size = document.createElement("input");
          size.type = "text";
          size.inputMode = "numeric";
          size.placeholder = item.sizes ? "Size (" + item.sizes + ")" : "Size";
          size.value = line.size || "";
        }
        size.className = "cart-size";
        size.setAttribute("aria-label", "Shoe size for " + item.name);
        size.addEventListener("change", function () { setSize(id, line.size || "", size.value.trim()); });

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
      placeOrderEl.textContent = !store.whatsapp
        ? "WhatsApp orders unavailable"
        : store.authenticated ? "Place order" : "Sign in to place order";
    }
    if (noteEl) noteEl.hidden = Boolean(store.whatsapp);
    var sizeWarning = document.getElementById("cart-size-warning");
    if (sizeWarning && !lines.some(function (line) {
      var item = store.products[line.id];
      return item && item.size_options && item.size_options.length && !line.size;
    })) sizeWarning.hidden = true;
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
      if (!store.authenticated) {
        window.location.assign("/checkout");
        return;
      }
      closeCart();
      openCheckout();
      return;
    }

    var checkoutCloser = event.target.closest("[data-checkout-close]");
    if (checkoutCloser) { event.preventDefault(); closeCheckout(); return; }

    var savedButton = event.target.closest("[data-wishlist]");
    if (savedButton) {
      event.preventDefault();
      event.stopPropagation();
      var saved = readWishlist();
      var savedId = savedButton.getAttribute("data-wishlist");
      var savedIndex = saved.indexOf(savedId);
      if (savedIndex === -1) saved.push(savedId);
      else saved.splice(savedIndex, 1);
      try { localStorage.setItem(WISHLIST_KEY, JSON.stringify(saved)); } catch (e) {}
      renderWishlist();
      applyProductFilters();
      return;
    }

    var savedToggle = event.target.closest("#saved-toggle");
    if (savedToggle) {
      savedToggle.setAttribute("aria-pressed", savedToggle.getAttribute("aria-pressed") === "true" ? "false" : "true");
      applyProductFilters();
      return;
    }

    if (event.target.closest("#filter-reset") || event.target.closest("#filter-empty-reset")) {
      event.preventDefault();
      var filterForm = document.querySelector(".listing-filters");
      if (filterForm) {
        filterForm.querySelectorAll("input").forEach(function (input) { input.value = ""; });
        filterForm.querySelectorAll("select").forEach(function (select) { select.value = select.id === "filter-size-info" ? "all" : ""; });
      }
      var savedToggleButton = document.getElementById("saved-toggle");
      if (savedToggleButton) savedToggleButton.setAttribute("aria-pressed", "false");
      applyProductFilters();
      return;
    }

    var chatbotOpen = event.target.closest("[data-chat-open]");
    if (chatbotOpen) { event.preventDefault(); openChat(); return; }

    var chatbotClose = event.target.closest("[data-chat-close]");
    if (chatbotClose) { event.preventDefault(); closeChat(); return; }

    var paymentChoice = event.target.closest(".payment-option");
    if (paymentChoice) {
      var selectedRadio = paymentChoice.querySelector("input[type='radio']");
      if (selectedRadio && selectedRadio.disabled) return;
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
      var selectedSize = document.getElementById("buy-size");
      if (selectedSize && !selectedSize.value) {
        selectedSize.reportValidity();
        return;
      }
      add(id, qtyInput ? parseInt(qtyInput.textContent, 10) || 1 : 1, selectedSize ? selectedSize.value : "");
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
      if (toggle && nav) {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      }
    }
  });

  var checkoutForm = document.getElementById("checkout-form");
  if (checkoutForm) {
    checkoutForm.addEventListener("input", renderOrderSummary);
    checkoutForm.addEventListener("change", renderOrderSummary);
    checkoutForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var missingSize = read().some(function (line) {
        var item = store.products[line.id];
        return item && item.size_options && item.size_options.length && !line.size;
      });
      if (missingSize) {
        closeCheckout();
        openCart();
        var sizeWarning = document.getElementById("cart-size-warning");
        if (sizeWarning) sizeWarning.hidden = false;
        return;
      }
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
      var statusMessage = document.getElementById("checkout-status");
      var confirmButton = document.getElementById("confirm-order");
      var orderWindow = window.open("about:blank", "_blank");
      if (confirmButton) confirmButton.disabled = true;
      if (statusMessage) statusMessage.textContent = "Saving your order request…";
      fetch("/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": store.csrf_token || ""
        },
        body: JSON.stringify({
          name: details.name,
          phone: details.phone,
          location: details.location,
          note: details.note,
          payment: details.payment,
          items: read().map(function (line) {
            return { id: line.id, qty: line.qty, size: line.size || "" };
          })
        })
      }).then(function (response) {
        return response.json().then(function (data) {
          if (response.status === 401 && data.sign_in_url) {
            window.location.assign(data.sign_in_url);
            throw new Error("Sign in to continue to checkout.");
          }
          if (!response.ok) throw new Error(data.error || "We could not save your order. Please try again.");
          return data;
        });
      }).then(function (data) {
        var whatsappUrl = orderUrl(details, data.tracking_code);
        write([]);
        if (orderWindow) {
          orderWindow.opener = null;
          orderWindow.location.replace(whatsappUrl);
          closeCheckout();
        } else if (statusMessage) {
          statusMessage.textContent = "Order saved. Continue to WhatsApp or keep your tracking code:";
          var whatsappLink = document.createElement("a");
          whatsappLink.href = whatsappUrl;
          whatsappLink.target = "_blank";
          whatsappLink.rel = "noopener";
          whatsappLink.textContent = "Open WhatsApp";
          var trackingLink = document.createElement("a");
          trackingLink.href = data.tracking_url;
          trackingLink.textContent = "Track order " + data.tracking_code;
          statusMessage.append(document.createElement("br"), whatsappLink, document.createElement("br"), trackingLink);
        }
      }).catch(function (error) {
        if (orderWindow) orderWindow.close();
        if (statusMessage) statusMessage.textContent = error.message || "We could not save your order. Please try again.";
      }).finally(function () {
        if (confirmButton) confirmButton.disabled = false;
      });
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
  var productCards = productGrid ? Array.prototype.slice.call(productGrid.querySelectorAll("[data-product-card]")) : [];
  var sizeFilter = document.getElementById("filter-size");
  function expandSizes(value) {
    var match = String(value || "").match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*$/);
    if (!match) return [];
    var sizes = [];
    for (var size = Number(match[1]); size <= Number(match[2]); size += 1) sizes.push(String(size));
    return sizes;
  }

  if (sizeFilter) {
    var allSizes = {};
    productCards.forEach(function (card) {
      expandSizes(card.getAttribute("data-sizes")).forEach(function (size) { allSizes[size] = true; });
    });
    Object.keys(allSizes).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (size) {
      var option = document.createElement("option");
      option.value = size;
      option.textContent = "EU " + size;
      sizeFilter.appendChild(option);
    });
  }

  function applyProductFilters() {
    if (!productGrid) return;
    var minField = document.getElementById("filter-min-price");
    var maxField = document.getElementById("filter-max-price");
    var sizeInfo = document.getElementById("filter-size-info");
    var savedToggle = document.getElementById("saved-toggle");
    var saved = readWishlist();
    var min = minField && minField.value !== "" ? Number(minField.value) : null;
    var max = maxField && maxField.value !== "" ? Number(maxField.value) : null;
    var wantedSize = sizeFilter ? sizeFilter.value : "";
    var infoMode = sizeInfo ? sizeInfo.value : "all";
    var onlySaved = savedToggle && savedToggle.getAttribute("aria-pressed") === "true";
    var visible = 0;
    productCards.forEach(function (card) {
      var price = Number(card.getAttribute("data-price"));
      var sizes = expandSizes(card.getAttribute("data-sizes"));
      var inRange = (min === null || (price > 0 && price >= min)) && (max === null || (price > 0 && price <= max));
      var sizeMatches = !wantedSize || sizes.indexOf(wantedSize) !== -1;
      var infoMatches = infoMode === "all" || (infoMode === "listed" ? sizes.length > 0 : sizes.length === 0);
      var savedMatches = !onlySaved || saved.indexOf(card.getAttribute("data-product-card")) !== -1;
      var matches = inRange && sizeMatches && infoMatches && savedMatches;
      card.hidden = !matches;
      if (matches) visible += 1;
    });
    var count = document.querySelector(".listing-count");
    var empty = document.getElementById("filter-empty");
    if (count) count.textContent = visible + " of " + productCards.length + " items";
    if (empty) empty.hidden = visible > 0;
  }

  if (sortSelect && productGrid) {
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
  document.querySelectorAll("#filter-min-price, #filter-max-price, #filter-size, #filter-size-info").forEach(function (control) {
    control.addEventListener("input", applyProductFilters);
    control.addEventListener("change", applyProductFilters);
  });

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
      return "Cash on delivery is currently available. M-Pesa checkout is not enabled yet, and no payment is collected on this website.";
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
      toggle.setAttribute("aria-label", open ? "Close site menu" : "Open site menu");
    });
    nav.addEventListener("click", function (event) {
      if (!event.target.closest(".cat-link") || window.innerWidth > 720) return;
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open site menu");
    });
    nav.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !nav.classList.contains("is-open")) return;
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open site menu");
      toggle.focus();
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

  var themeButton = document.getElementById("theme-toggle");
  function applyTheme(theme) {
    var dark = theme === "dark";
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    if (themeButton) {
      themeButton.textContent = dark ? "☀" : "☾";
      themeButton.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
      themeButton.setAttribute("aria-pressed", dark ? "true" : "false");
      themeButton.title = dark ? "Switch to light theme" : "Switch to dark theme";
    }
    var themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = dark ? "#111318" : "#ffffff";
  }
  applyTheme(document.documentElement.getAttribute("data-theme") || "dark");
  if (themeButton) {
    themeButton.addEventListener("click", function () {
      var nextTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
      try { localStorage.setItem("footmart-theme-v1", nextTheme); } catch (e) {}
    });
  }

  var recentSection = document.getElementById("recently-viewed-section");
  var recentList = document.getElementById("recently-viewed-list");
  var viewedProduct = document.querySelector("[data-view-product]");
  if (viewedProduct) {
    var viewedId = viewedProduct.getAttribute("data-view-product");
    try {
      var viewedIds = JSON.parse(localStorage.getItem("footmart-recent-v1") || "[]");
      if (!Array.isArray(viewedIds)) viewedIds = [];
      viewedIds = [viewedId].concat(viewedIds.filter(function (id) { return id !== viewedId; })).slice(0, 8);
      localStorage.setItem("footmart-recent-v1", JSON.stringify(viewedIds));
    } catch (e) {
      viewedIds = [viewedId];
    }
  } else {
    try {
      viewedIds = JSON.parse(localStorage.getItem("footmart-recent-v1") || "[]");
      if (!Array.isArray(viewedIds)) viewedIds = [];
    } catch (e) {
      viewedIds = [];
    }
  }
  if (recentSection && recentList && viewedIds.length) {
    viewedIds.forEach(function (id) {
      var item = store.products[id];
      if (!item) return;
      var link = document.createElement("a");
      link.className = "recent-card";
      link.href = "/product/" + encodeURIComponent(id);
      var image = document.createElement("img");
      image.src = "/img/thumb_" + item.images[0];
      image.alt = item.name;
      image.loading = "lazy";
      var name = document.createElement("strong");
      name.textContent = item.name;
      var price = document.createElement("span");
      price.textContent = money(item);
      link.append(image, name, price);
      recentList.appendChild(link);
    });
    recentSection.hidden = !recentList.children.length;
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

  renderWishlist();
  applyProductFilters();
  render();
  if (new URLSearchParams(window.location.search).get("checkout") === "1") {
    openCheckout();
  }
})();
