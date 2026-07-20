import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getDatabase, ref, onValue, push, remove, update, set
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBkoxRXOA5SP4efmdGCrDx_Tvh4pEhDl-w",
  authDomain: "shopping-list-f4d2b.firebaseapp.com",
  databaseURL: "https://shopping-list-f4d2b-default-rtdb.firebaseio.com",
  projectId: "shopping-list-f4d2b",
  storageBucket: "shopping-list-f4d2b.firebasestorage.app",
  messagingSenderId: "755163994586",
  appId: "1:755163994586:web:0af536d5f1617cf97348e3",
  measurementId: "G-82NQPDH267"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

const DB_ROOT = "k9p2x7m4-a8f3q1n6-r5b0c3e2";

const STATUSES = [
  { id: "want",      emoji: "🟡", label: "Want",             bg: "#fffbea", color: "#9a6f00" },
  { id: "sale",      emoji: "🟠", label: "Waiting for Sale", bg: "#fff4e6", color: "#c05800" },
  { id: "purchased", emoji: "🟢", label: "Purchased",        bg: "#eafaf1", color: "#1a7a38" },
  { id: "cancelled", emoji: "🔴", label: "Cancelled",        bg: "#ffebeb", color: "#c00000" },
];

function statusById(id) {
  return STATUSES.find(s => s.id === id) || STATUSES[0];
}

function getItemStatus(item) {
  if (item.status) return item.status;
  return item.done ? "purchased" : "want";
}

const CATEGORIES = [
  { id: "clothes",  emoji: "👕", label: "Clothes"  },
  { id: "shoes",    emoji: "👟", label: "Shoes"    },
  { id: "beauty",   emoji: "💄", label: "Beauty"   },
  { id: "perfumes", emoji: "🌸", label: "Perfumes" },
  { id: "bags",     emoji: "👜", label: "Bags"     },
  { id: "watches",  emoji: "⌚", label: "Watches"  },
  { id: "other",    emoji: "📦", label: "Other"    },
];

function catById(id) {
  return CATEGORIES.find(c => c.id === id) || { emoji: "📦", label: "Other" };
}

// { family: { memberId: { name, items: { itemId: {...} } } } }
const cache = { a: {}, b: {} };

let budgetLimit  = 0;
const activeFilter = { a: "", b: "" }; // category filter, "" = All
const activeStatus = { a: "", b: "" }; // status filter, "" = All
const activePerson = { a: "", b: "" }; // person filter, "" = All
const searchQuery  = { a: "", b: "" }; // text search
let selectedCategory = "";

// ── Connection indicator ──────────────────────────────────────────

onValue(ref(db, ".info/connected"), snap => {
  const online = snap.val() === true;
  document.getElementById("conn-dot").className     = "status-dot " + (online ? "online" : "offline");
  document.getElementById("conn-label").textContent = online ? "Synced" : "Offline";
});

// ── Helpers ───────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function checkSvg() {
  return `<svg class="check-icon" width="10" height="8" viewBox="0 0 10 8" fill="none">
    <path d="M1 3.5l3 3 5-5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function nameColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  const palette = ["#4f7cff","#ff6b9d","#ff9500","#34c759","#af52de","#5856d6","#ff6b2b","#00bcd4"];
  return palette[Math.abs(h) % palette.length];
}

function compressImage(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 400;
        let { width: w, height: h } = img;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Item filter helper ────────────────────────────────────────────

function matchesFilters(family, item) {
  const cat    = activeFilter[family];
  const status = activeStatus[family];
  const q      = searchQuery[family].toLowerCase().trim();

  if (cat && item.category !== cat) return false;
  if (status && getItemStatus(item) !== status) return false;
  if (q) {
    const inText  = (item.text  || "").toLowerCase().includes(q);
    const inNotes = (item.notes || "").toLowerCase().includes(q);
    if (!inText && !inNotes) return false;
  }
  return true;
}

// ── Filter panel ──────────────────────────────────────────────────

function renderFilterPanel(family) {
  const panel = document.getElementById("sf-panel-" + family);
  if (!panel) return;

  const cat    = activeFilter[family];
  const status = activeStatus[family];

  const catOptions  = [{ id: "", label: "All" }, ...CATEGORIES.map(c => ({ id: c.id, label: c.emoji + " " + c.label }))];
  const statOptions = [{ id: "", label: "All" }, ...STATUSES.map(s => ({ id: s.id, label: s.emoji + " " + s.label }))];

  panel.innerHTML = `
    <div class="fp-group">
      <div class="fp-label">Category</div>
      <div class="fp-chips">
        ${catOptions.map(c => `<button class="fp-chip ${cat === c.id ? "active" : ""}" data-fp-cat="${c.id}">${c.label}</button>`).join("")}
      </div>
    </div>
    <div class="fp-group">
      <div class="fp-label">Status</div>
      <div class="fp-chips">
        ${statOptions.map(s => `<button class="fp-chip ${status === s.id ? "active" : ""}" data-fp-status="${s.id}">${s.label}</button>`).join("")}
      </div>
    </div>
  `;

  // Update toggle button badge
  const toggle = document.getElementById("sf-toggle-" + family);
  if (toggle) {
    const count = [cat, status].filter(Boolean).length;
    toggle.innerHTML = `
      <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
        <path d="M1 2h12M3 6h8M5 10h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      Filters${count ? ` <span class="sf-badge">${count}</span>` : ""}
    `;
    toggle.classList.toggle("has-filters", count > 0);
  }
}

// ── Render: family & sections ─────────────────────────────────────

function renderFamily(family) {
  const container = document.getElementById("sections-" + family);
  const members   = cache[family];
  let entries     = Object.entries(members).sort((a, b) => a[0] > b[0] ? 1 : -1);

  if (entries.length === 0) {
    container.innerHTML = `<p class="empty-section">No people yet — add someone below.</p>`;
  } else {
    const person = activePerson[family];
    if (person) entries = entries.filter(([id]) => id === person);
    container.innerHTML = entries.length
      ? entries.map(([memberId, member]) => buildSection(family, memberId, member)).join("")
      : `<p class="empty-section">No people match this filter.</p>`;
  }

  const total = Object.values(members).reduce((sum, m) => {
    return sum + Object.values(m.items || {}).filter(i => {
      const s = getItemStatus(i);
      return s === "want" || s === "sale";
    }).length;
  }, 0);
  document.getElementById("count-" + family).textContent = total;
}

function buildSection(family, memberId, member) {
  const color    = nameColor(member.name);
  const allItems = Object.entries(member.items || {})
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));

  const entries  = allItems.filter(([, i]) => matchesFilters(family, i));

  const wishlist  = entries.filter(([, i]) => getItemStatus(i) !== "purchased");
  const purchased = entries.filter(([, i]) => getItemStatus(i) === "purchased");

  const hasFilters = activeFilter[family] || activeStatus[family] || searchQuery[family];

  const wishlistSection = (wishlist.length > 0 || hasFilters) ? `
    <div class="subsection">
      <div class="subsection-header">
        <span>Wishlist</span>
        <span class="subsection-count">${wishlist.length}</span>
      </div>
      <div class="items-list">
        ${wishlist.length === 0
          ? `<p class="empty-section">No matching items</p>`
          : wishlist.map(([id, item], i) => buildItemCard(family, memberId, id, item, i)).join("")}
      </div>
    </div>` : "";

  const purchasedSection = purchased.length === 0 ? "" : `
    <div class="subsection subsection-purchased">
      <div class="subsection-header">
        <span>Purchased</span>
        <span class="subsection-count">${purchased.length}</span>
      </div>
      <div class="items-list">
        ${purchased.map(([id, item], i) => buildItemCard(family, memberId, id, item, i)).join("")}
      </div>
    </div>`;

  return `
    <div class="person-section" id="ps-${family}-${memberId}" style="--person-color:${color}">
      <div class="ps-header">
        <div class="ps-bar"></div>
        <span class="ps-name">${esc(member.name)}</span>
        <button class="ps-add-btn" data-action="open-inline" data-family="${family}" data-member="${memberId}">+ Add item</button>
        <button class="ps-del-btn" data-action="delete-person" data-family="${family}" data-member="${memberId}" title="Remove person">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
          </svg>
        </button>
      </div>
      <div class="inline-form-slot" id="ifs-${family}-${memberId}"></div>
      ${wishlistSection}
      ${purchasedSection}
    </div>`;
}

function buildItemCard(family, memberId, itemId, item, index = 0) {
  const cat    = catById(item.category);
  const status = statusById(getItemStatus(item));

  const thumb = item.imageUrl
    ? `<img class="item-thumb" src="${esc(item.imageUrl)}" alt=""
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
       <div class="item-thumb-placeholder" style="display:none">${cat.emoji}</div>`
    : `<div class="item-thumb-placeholder">${cat.emoji}</div>`;

  const price = item.price
    ? `<div class="item-price">$${esc(item.price)}</div>`
    : "";

  const catBadge = item.category
    ? `<div class="item-cat-badge">${cat.emoji} ${cat.label}</div>`
    : "";

  const productBtn = item.productLink
    ? `<a class="view-product-btn" href="${esc(item.productLink)}" target="_blank" rel="noopener noreferrer">↗ View Product</a>`
    : "";

  const notesBadge = item.notes
    ? `<div class="item-notes">${esc(item.notes)}</div>`
    : "";

  const statusPills = STATUSES.map(s => `
    <button class="status-pill ${s.id === status.id ? "active" : ""}"
            data-action="set-status" data-status="${s.id}"
            style="--pill-bg:${s.bg};--pill-color:${s.color}">
      ${s.emoji} ${s.label}
    </button>`).join("");

  return `
    <div class="item-card" data-status="${status.id}"
         data-family="${family}" data-member="${memberId}" data-item="${itemId}"
         style="animation-delay:${index * 45}ms">
      <div class="item-main">
        ${thumb}
        <div class="item-details">
          <div class="item-name">${esc(item.text)}</div>
          ${price}
          ${catBadge}
          ${notesBadge}
          ${productBtn}
        </div>
        <div class="item-card-actions">
          <button class="item-action-btn" data-action="open-status"
                  style="background:${status.bg};color:${status.color}" title="Change status">
            ${status.emoji} ${status.label}
          </button>
          <button class="item-action-btn item-edit-btn" data-action="edit-item" title="Edit item">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
              <path d="m15 5 4 4"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="status-inline">${statusPills}</div>
    </div>`;
}

// ── Budget ────────────────────────────────────────────────────────

function calcTotal() {
  let total = 0;
  ["a", "b"].forEach(f => {
    Object.values(cache[f]).forEach(member => {
      Object.values(member.items || {}).forEach(item => {
        if (getItemStatus(item) === "cancelled") return;
        const p = parseFloat(item.price);
        if (!isNaN(p)) total += p;
      });
    });
  });
  return total;
}

function updateBudgetBar() {
  const total  = calcTotal();
  const hasLim = budgetLimit > 0;
  const pct    = hasLim ? Math.min((total / budgetLimit) * 100, 100) : 0;
  const over   = hasLim && total > budgetLimit;
  const color  = over ? "#ff4d4d" : pct >= 75 ? "#ff9500" : "#34c759";

  document.getElementById("budget-spent").textContent          = `$${total.toFixed(2)}`;
  document.getElementById("budget-amount").textContent         = hasLim ? `$${budgetLimit.toFixed(2)}` : "—";
  document.getElementById("budget-bar-fill").style.width       = `${pct}%`;
  document.getElementById("budget-bar-fill").style.background  = color;
  document.getElementById("budget-spent").style.color          = over ? "#ff4d4d" : "var(--text)";

  const footer = document.getElementById("budget-footer");
  if (!hasLim) {
    footer.textContent = "No budget set — click Edit to add one";
  } else if (over) {
    const diff = (total - budgetLimit).toFixed(2);
    footer.innerHTML = `<span style="color:#ff4d4d;font-weight:700">$${diff} over budget</span><span>${Math.round(pct)}% used</span>`;
  } else {
    const remain = (budgetLimit - total).toFixed(2);
    footer.innerHTML = `<span>$${remain} remaining</span><span>${Math.round(pct)}% used</span>`;
  }
}

function editBudget() {
  const current = budgetLimit > 0 ? budgetLimit.toFixed(2) : "";
  const input   = prompt("Set total budget ($):", current);
  if (input === null) return;
  const value = parseFloat(input);
  if (!isNaN(value) && value >= 0) set(ref(db, `${DB_ROOT}/budget`), value);
}

document.getElementById("budget-edit-btn").addEventListener("click", editBudget);

// ── Firebase listeners ────────────────────────────────────────────

onValue(ref(db, `${DB_ROOT}/budget`), snap => {
  budgetLimit = snap.val() || 0;
  updateBudgetBar();
});

["a", "b"].forEach(family => {
  onValue(ref(db, `${DB_ROOT}/${family}/members`), snap => {
    cache[family] = snap.val() || {};
    renderFamily(family);
    renderFilterPanel(family);
    updateBudgetBar();
    renderDashboard();
  });

  onValue(ref(db, `${DB_ROOT}/${family}/name`), snap => {
    const name = snap.val();
    if (name) document.getElementById("tab-name-" + family).textContent = name;
  });
});

// Skeleton loading — shown before Firebase data arrives
function buildSkeletonCard() {
  return `<div class="skel-card">
    <div class="skel skel-thumb"></div>
    <div class="skel-card-lines">
      <div class="skel skel-line" style="width:58%"></div>
      <div class="skel skel-line" style="width:28%"></div>
      <div class="skel skel-line" style="width:42%"></div>
    </div>
    <div class="skel skel-pill"></div>
  </div>`;
}

function buildSkeletonSection(cardCount) {
  return `<div class="skel-section">
    <div class="skel-header">
      <div class="skel skel-avatar"></div>
      <div class="skel skel-line" style="width:90px"></div>
      <div style="margin-left:auto;display:flex;gap:8px">
        <div class="skel skel-line" style="width:72px;height:28px;border-radius:99px"></div>
        <div class="skel skel-line" style="width:26px;height:26px;border-radius:8px"></div>
      </div>
    </div>
    <div class="skel-body">
      ${Array.from({ length: cardCount }, buildSkeletonCard).join("")}
    </div>
  </div>`;
}

function showSkeletons(family) {
  const container = document.getElementById("sections-" + family);
  if (container) {
    container.innerHTML =
      buildSkeletonSection(3) +
      buildSkeletonSection(2);
  }
}

showSkeletons("a");
showSkeletons("b");

// Init filter panels (before data arrives)
renderFilterPanel("a");
renderFilterPanel("b");

// ── Inline Add Form ───────────────────────────────────────────────

let inlineCtx        = { family: null, memberId: null };
let inlinePendingImg = null;
let inlineSelCat     = "";

function openInlineForm(family, memberId) {
  closeInlineForm();

  const slot = document.getElementById(`ifs-${family}-${memberId}`);
  if (!slot) return;

  inlineCtx        = { family, memberId };
  inlinePendingImg = null;
  inlineSelCat     = "";

  const color  = nameColor(cache[family]?.[memberId]?.name || "");
  const catHtml = CATEGORIES.map(c => `
    <button class="if-cat-btn" data-ifcat="${c.id}">
      <span class="if-cat-emoji">${c.emoji}</span>
      <span class="if-cat-label">${c.label}</span>
    </button>`).join("");

  slot.innerHTML = `
    <div class="inline-form" style="--if-color:${color}">
      <div class="if-label">Category</div>
      <div class="if-cat-row" id="if-cats">${catHtml}</div>
      <input class="field-input" id="if-name"  placeholder="Item name"          maxlength="100" />
      <input class="field-input" id="if-price" placeholder="Price e.g. 49.99"  maxlength="20"  />
      <input class="field-input" id="if-link"  type="url" placeholder="Product link (optional)" />
      <textarea class="field-input if-notes-field" id="if-notes" placeholder="Notes: size, color, store… (optional)" rows="2"></textarea>
      <div class="img-row">
        <input class="field-input img-url-input" id="if-url" placeholder="Paste image URL…" />
        <label class="upload-btn" title="Upload from device">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Upload
          <input type="file" id="if-file" accept="image/*" />
        </label>
      </div>
      <div class="img-preview" id="if-preview">
        <img id="if-preview-img" alt="preview" />
        <button class="remove-img-btn" id="if-remove-img">✕ Remove</button>
      </div>
      <div class="if-actions">
        <button class="btn-cancel" id="if-cancel">Cancel</button>
        <button class="btn-submit" id="if-submit" style="background:${color}">Add Item</button>
      </div>
    </div>`;

  document.getElementById("if-cats").addEventListener("click", e => {
    const btn = e.target.closest("[data-ifcat]");
    if (!btn) return;
    inlineSelCat = btn.dataset.ifcat;
    document.querySelectorAll("#if-cats [data-ifcat]")
      .forEach(b => b.classList.toggle("active", b.dataset.ifcat === inlineSelCat));
  });

  document.getElementById("if-url").addEventListener("input", e => {
    const val = e.target.value.trim();
    if (val) { inlinePendingImg = null; showInlinePreview(val); }
    else document.getElementById("if-preview").classList.remove("visible");
  });

  document.getElementById("if-file").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    const data = await compressImage(file);
    inlinePendingImg = data;
    document.getElementById("if-url").value = "";
    showInlinePreview(data);
  });

  document.getElementById("if-remove-img").addEventListener("click", () => {
    inlinePendingImg = null;
    document.getElementById("if-url").value   = "";
    document.getElementById("if-file").value  = "";
    document.getElementById("if-preview-img").src = "";
    document.getElementById("if-preview").classList.remove("visible");
  });

  document.getElementById("if-cancel").addEventListener("click", closeInlineForm);
  document.getElementById("if-submit").addEventListener("click", submitInlineForm);
  ["if-name", "if-price", "if-link"].forEach(id => {
    document.getElementById(id).addEventListener("keydown", e => {
      if (e.key === "Enter") submitInlineForm();
    });
  });

  setTimeout(() => document.getElementById("if-name").focus({ preventScroll: true }), 50);
}

function showInlinePreview(src) {
  document.getElementById("if-preview-img").src = src;
  document.getElementById("if-preview").classList.add("visible");
}

function closeInlineForm() {
  const { family, memberId } = inlineCtx;
  if (family && memberId) {
    const slot = document.getElementById(`ifs-${family}-${memberId}`);
    if (slot) slot.innerHTML = "";
  }
  inlineCtx        = { family: null, memberId: null };
  inlinePendingImg = null;
  inlineSelCat     = "";
}

async function submitInlineForm() {
  const text  = document.getElementById("if-name")?.value.trim()  || "";
  const price = document.getElementById("if-price")?.value.trim() || "";
  const url   = document.getElementById("if-url")?.value.trim()   || "";
  const link  = document.getElementById("if-link")?.value.trim()  || "";
  const notes = document.getElementById("if-notes")?.value.trim() || "";

  if (!inlineSelCat) {
    const row = document.getElementById("if-cats");
    if (row) { row.style.outline = "2px solid #ef4444"; row.style.borderRadius = "10px"; setTimeout(() => { row.style.outline = ""; }, 1200); }
    return;
  }
  if (!text)  { document.getElementById("if-name")?.focus({ preventScroll: true });  return; }
  if (!price) { document.getElementById("if-price")?.focus({ preventScroll: true }); return; }

  const btn = document.getElementById("if-submit");
  if (btn) btn.disabled = true;

  const { family, memberId } = inlineCtx;
  const imageUrl = inlinePendingImg || url;

  await push(ref(db, `${DB_ROOT}/${family}/members/${memberId}/items`), {
    text, price, imageUrl, productLink: link, notes,
    category: inlineSelCat, done: false, createdAt: Date.now()
  });

  closeInlineForm();
}

// ── Inline Edit Form ──────────────────────────────────────────────

let inlineEditCtx        = { family: null, memberId: null, itemId: null };
let inlineEditPendingImg = null;
let inlineEditSelCat     = "";

function openInlineEdit(family, memberId, itemId) {
  closeInlineEdit();

  const card = document.querySelector(
    `.item-card[data-family="${family}"][data-member="${memberId}"][data-item="${itemId}"]`
  );
  if (!card) return;

  const item = cache[family]?.[memberId]?.items?.[itemId];
  if (!item) return;

  inlineEditCtx        = { family, memberId, itemId };
  inlineEditSelCat     = item.category || "";
  const imgSrc         = item.imageUrl || "";
  inlineEditPendingImg = imgSrc.startsWith("data:") ? imgSrc : null;
  const urlVal         = imgSrc && !imgSrc.startsWith("data:") ? imgSrc : "";

  const color  = nameColor(cache[family]?.[memberId]?.name || "");
  const catHtml = CATEGORIES.map(c => `
    <button class="if-cat-btn ${c.id === inlineEditSelCat ? "active" : ""}" data-iefcat="${c.id}">
      <span class="if-cat-emoji">${c.emoji}</span>
      <span class="if-cat-label">${c.label}</span>
    </button>`).join("");

  card.classList.add("item-editing");
  card.insertAdjacentHTML("beforeend", `
    <div class="item-edit-form" style="--if-color:${color}">
      <div class="if-label">Category</div>
      <div class="if-cat-row" id="ief-cats">${catHtml}</div>
      <input class="field-input" id="ief-name"  value="${esc(item.text || "")}"         placeholder="Item name"              maxlength="100" />
      <input class="field-input" id="ief-price" value="${esc(item.price || "")}"        placeholder="Price e.g. 49.99"        maxlength="20"  />
      <input class="field-input" id="ief-link"  value="${esc(item.productLink || "")}"  type="url" placeholder="Product link (optional)" />
      <textarea class="field-input if-notes-field" id="ief-notes" placeholder="Notes: size, color, store… (optional)" rows="2">${esc(item.notes || "")}</textarea>
      <div class="img-row">
        <input class="field-input img-url-input" id="ief-url" value="${esc(urlVal)}" placeholder="Paste image URL…" />
        <label class="upload-btn" title="Upload from device">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Upload
          <input type="file" id="ief-file" accept="image/*" />
        </label>
      </div>
      <div class="img-preview${imgSrc ? " visible" : ""}" id="ief-preview">
        <img id="ief-preview-img" src="${esc(imgSrc)}" alt="preview" />
        <button class="remove-img-btn" id="ief-remove-img">✕ Remove</button>
      </div>
      <div class="if-actions">
        <button class="btn-cancel" id="ief-cancel">Cancel</button>
        <button class="btn-submit" id="ief-submit" style="background:${color}">Save Changes</button>
      </div>
    </div>`);

  document.getElementById("ief-cats").addEventListener("click", e => {
    const btn = e.target.closest("[data-iefcat]");
    if (!btn) return;
    inlineEditSelCat = btn.dataset.iefcat;
    document.querySelectorAll("#ief-cats [data-iefcat]")
      .forEach(b => b.classList.toggle("active", b.dataset.iefcat === inlineEditSelCat));
  });

  document.getElementById("ief-url").addEventListener("input", e => {
    const val = e.target.value.trim();
    if (val) { inlineEditPendingImg = null; document.getElementById("ief-preview-img").src = val; document.getElementById("ief-preview").classList.add("visible"); }
    else document.getElementById("ief-preview").classList.remove("visible");
  });

  document.getElementById("ief-file").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    const data = await compressImage(file);
    inlineEditPendingImg = data;
    document.getElementById("ief-url").value = "";
    document.getElementById("ief-preview-img").src = data;
    document.getElementById("ief-preview").classList.add("visible");
  });

  document.getElementById("ief-remove-img").addEventListener("click", () => {
    inlineEditPendingImg = null;
    document.getElementById("ief-url").value  = "";
    document.getElementById("ief-file").value = "";
    document.getElementById("ief-preview-img").src = "";
    document.getElementById("ief-preview").classList.remove("visible");
  });

  document.getElementById("ief-cancel").addEventListener("click", closeInlineEdit);
  document.getElementById("ief-submit").addEventListener("click", submitInlineEdit);
  ["ief-name", "ief-price", "ief-link"].forEach(id => {
    document.getElementById(id)?.addEventListener("keydown", e => {
      if (e.key === "Enter") submitInlineEdit();
    });
  });

  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  setTimeout(() => document.getElementById("ief-name")?.focus({ preventScroll: true }), 80);
}

function closeInlineEdit() {
  const card = document.querySelector(".item-card.item-editing");
  if (card) {
    card.querySelector(".item-edit-form")?.remove();
    card.classList.remove("item-editing");
  }
  inlineEditCtx        = { family: null, memberId: null, itemId: null };
  inlineEditPendingImg = null;
  inlineEditSelCat     = "";
}

async function submitInlineEdit() {
  const text  = document.getElementById("ief-name")?.value.trim()  || "";
  const price = document.getElementById("ief-price")?.value.trim() || "";
  const url   = document.getElementById("ief-url")?.value.trim()   || "";
  const link  = document.getElementById("ief-link")?.value.trim()  || "";
  const notes = document.getElementById("ief-notes")?.value.trim() || "";

  if (!inlineEditSelCat) {
    const row = document.getElementById("ief-cats");
    if (row) { row.style.outline = "2px solid #ef4444"; row.style.borderRadius = "10px"; setTimeout(() => { row.style.outline = ""; }, 1200); }
    return;
  }
  if (!text)  { document.getElementById("ief-name")?.focus({ preventScroll: true });  return; }
  if (!price) { document.getElementById("ief-price")?.focus({ preventScroll: true }); return; }

  const btn = document.getElementById("ief-submit");
  if (btn) btn.disabled = true;

  const { family, memberId, itemId } = inlineEditCtx;
  const imageUrl = inlineEditPendingImg || url;

  await update(ref(db, `${DB_ROOT}/${family}/members/${memberId}/items/${itemId}`), {
    text, price, imageUrl, productLink: link, notes, category: inlineEditSelCat
  });

  closeInlineEdit();
}

// ── Modal ─────────────────────────────────────────────────────────

let modalCtx   = { family: null, memberId: null };
let pendingImg = null;

const modalEl       = document.getElementById("modal");
const modalBarEl    = document.getElementById("modal-bar");
const modalNameEl   = document.getElementById("modal-person-name");
const modalSubmitEl = document.getElementById("modal-submit");
const previewEl     = document.getElementById("modal-preview");
const previewImgEl  = document.getElementById("modal-preview-img");
const urlInputEl    = document.getElementById("modal-url");
const nameInputEl   = document.getElementById("modal-name");
const priceInputEl  = document.getElementById("modal-price");
const fileInputEl   = document.getElementById("modal-file");
const linkInputEl   = document.getElementById("modal-link");
const notesInputEl  = document.getElementById("modal-notes");
const catPickerEl   = document.getElementById("modal-cat-picker");

function renderCatPicker() {
  catPickerEl.innerHTML = CATEGORIES.map(c => `
    <button class="cat-btn ${selectedCategory === c.id ? "active" : ""}" data-cat="${c.id}">
      <span class="cat-emoji">${c.emoji}</span>${c.label}
    </button>
  `).join("");
}

catPickerEl.addEventListener("click", e => {
  const btn = e.target.closest(".cat-btn");
  if (!btn) return;
  selectedCategory = btn.dataset.cat;
  renderCatPicker();
});

function openModal(family, memberId, itemId) {
  const member = cache[family][memberId];
  if (!member) return;
  const color   = nameColor(member.name);
  const isEdit  = !!itemId;
  const item    = isEdit ? (member.items || {})[itemId] : null;

  modalCtx         = { family, memberId, itemId: itemId || null };
  pendingImg       = null;
  selectedCategory = isEdit ? (item?.category || "") : "";

  nameInputEl.value  = isEdit ? (item?.text  || "") : "";
  priceInputEl.value = isEdit ? (item?.price || "") : "";
  linkInputEl.value  = isEdit ? (item?.productLink || "") : "";
  notesInputEl.value = isEdit ? (item?.notes || "") : "";
  fileInputEl.value  = "";

  const imgSrc = isEdit ? (item?.imageUrl || "") : "";
  urlInputEl.value = imgSrc && !imgSrc.startsWith("data:") ? imgSrc : "";
  if (imgSrc) { pendingImg = imgSrc.startsWith("data:") ? imgSrc : null; showPreview(imgSrc); }
  else { previewEl.classList.remove("visible"); previewImgEl.src = ""; }

  modalNameEl.textContent        = isEdit ? `Edit · ${member.name}` : member.name;
  modalBarEl.style.background    = color;
  modalSubmitEl.style.background = color;
  modalSubmitEl.textContent      = isEdit ? "Save Changes" : "Add Item";
  catPickerEl.style.setProperty("--person-color", color);

  renderCatPicker();
  modalEl.classList.add("open");
  setTimeout(() => nameInputEl.focus({ preventScroll: true }), 100);
}

function closeModal() {
  modalEl.classList.remove("open");
  modalCtx         = { family: null, memberId: null, itemId: null };
  pendingImg       = null;
  selectedCategory = "";
  modalSubmitEl.textContent = "Add Item";
}

async function submitModal() {
  const text        = nameInputEl.value.trim();
  const price       = priceInputEl.value.trim();
  const url         = urlInputEl.value.trim();
  const productLink = linkInputEl.value.trim();
  const notes       = notesInputEl.value.trim();

  if (!selectedCategory) {
    catPickerEl.style.outline = "2px solid #ff4d4d";
    catPickerEl.style.borderRadius = "10px";
    setTimeout(() => { catPickerEl.style.outline = ""; }, 1200);
    return;
  }
  if (!text)  { nameInputEl.focus();  return; }
  if (!price) { priceInputEl.focus(); return; }

  const imageUrl = pendingImg || url;
  const { family, memberId, itemId } = modalCtx;

  if (itemId) {
    await update(ref(db, `${DB_ROOT}/${family}/members/${memberId}/items/${itemId}`), {
      text, price, imageUrl, productLink, notes, category: selectedCategory
    });
  } else {
    await push(ref(db, `${DB_ROOT}/${family}/members/${memberId}/items`), {
      text, price, imageUrl, productLink, notes,
      category: selectedCategory, done: false, createdAt: Date.now()
    });
  }

  closeModal();
}

function showPreview(src) {
  previewImgEl.src = src;
  previewEl.classList.add("visible");
}

function clearPreview() {
  pendingImg        = null;
  previewImgEl.src  = "";
  urlInputEl.value  = "";
  fileInputEl.value = "";
  previewEl.classList.remove("visible");
}

urlInputEl.addEventListener("input", () => {
  const val = urlInputEl.value.trim();
  if (val) { pendingImg = null; showPreview(val); }
  else previewEl.classList.remove("visible");
});

fileInputEl.addEventListener("change", async () => {
  const file = fileInputEl.files[0];
  if (!file) return;
  const data      = await compressImage(file);
  pendingImg      = data;
  urlInputEl.value = "";
  showPreview(data);
});

document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-cancel").addEventListener("click", closeModal);
document.getElementById("modal-submit").addEventListener("click", submitModal);
document.getElementById("modal-remove-img").addEventListener("click", clearPreview);
modalEl.addEventListener("click", e => { if (e.target === modalEl) closeModal(); });

[nameInputEl, priceInputEl, linkInputEl, urlInputEl].forEach(el => {
  el.addEventListener("keydown", e => { if (e.key === "Enter") submitModal(); });
});

// ── Item / person actions ─────────────────────────────────────────

function setItemStatus(family, memberId, itemId, status) {
  update(ref(db, `${DB_ROOT}/${family}/members/${memberId}/items/${itemId}`), { status });
}

function addPerson(family) {
  const name = prompt("Person name:");
  if (!name || !name.trim()) return;
  push(ref(db, `${DB_ROOT}/${family}/members`), { name: name.trim() });
}

function deletePerson(family, memberId) {
  const name = cache[family][memberId]?.name || "this person";
  if (!confirm(`Remove ${name} and all their items?`)) return;
  remove(ref(db, `${DB_ROOT}/${family}/members/${memberId}`));
}

// Close status picker when clicking outside
document.addEventListener("click", e => {
  if (!e.target.closest(".item-card.status-open")) {
    document.querySelectorAll(".item-card.status-open")
      .forEach(c => c.classList.remove("status-open"));
  }
});

// ── Tab switching ─────────────────────────────────────────────────

function switchFamily(family) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelector(`.tab[data-family="${family}"]`).classList.add("active");
  document.getElementById("panel-" + family).classList.add("active");
}

// ── Event wiring ──────────────────────────────────────────────────

document.getElementById("tab-a").addEventListener("click", () => switchFamily("a"));
document.getElementById("tab-b").addEventListener("click", () => switchFamily("b"));
document.getElementById("add-person-a").addEventListener("click", () => addPerson("a"));
document.getElementById("add-person-b").addEventListener("click", () => addPerson("b"));

["a", "b"].forEach(family => {
  // Search input
  document.getElementById("search-" + family).addEventListener("input", e => {
    searchQuery[family] = e.target.value;
    renderFamily(family);
    renderFilterPanel(family);
  });

  // Filter toggle (open/close panel)
  document.getElementById("sf-toggle-" + family).addEventListener("click", () => {
    document.getElementById("sf-panel-" + family).classList.toggle("open");
  });

  // Filter panel chip clicks
  document.getElementById("sf-panel-" + family).addEventListener("click", e => {
    const chip = e.target.closest(".fp-chip");
    if (!chip) return;
    if ("fpCat" in chip.dataset)    activeFilter[family] = chip.dataset.fpCat;
    if ("fpStatus" in chip.dataset) activeStatus[family] = chip.dataset.fpStatus;
    renderFamily(family);
    renderFilterPanel(family);
  });

  // Section / item actions
  document.getElementById("panel-" + family).addEventListener("click", e => {
    const btn      = e.target.closest("[data-action]");
    if (!btn) return;
    const action   = btn.dataset.action;
    const card     = btn.closest("[data-item]");
    const memberId = btn.dataset.member || card?.dataset.member
                  || btn.closest("[data-member]")?.dataset.member;
    const itemId   = card?.dataset.item;

    if (action === "open-inline")   { openInlineForm(btn.dataset.family, memberId); return; }
    if (action === "delete-person") { deletePerson(btn.dataset.family, memberId); return; }
    if (action === "edit-item")     { openInlineEdit(card.dataset.family, card.dataset.member, card.dataset.item); return; }

    if (action === "open-status") {
      document.querySelectorAll(".item-card.status-open")
        .forEach(c => { if (c !== card) c.classList.remove("status-open"); });
      card?.classList.toggle("status-open");
      e.stopPropagation();
      return;
    }

    if (action === "set-status") {
      setItemStatus(family, memberId, itemId, btn.dataset.status);
      card?.classList.remove("status-open");
      return;
    }
  });
});

// ── Dashboard ─────────────────────────────────────────────────────

const CAT_COLORS = {
  clothes:  "#6366F1",
  shoes:    "#EC4899",
  beauty:   "#8B5CF6",
  perfumes: "#F59E0B",
  bags:     "#10B981",
  watches:  "#0EA5E9",
  other:    "#64748B",
};

function getDashboardData() {
  const d = {
    total: 0, wishlist: 0, purchased: 0, cancelled: 0, totalValue: 0,
    byCategory: {},
    byStatus:   {},
    byFamily: {
      a: { name: document.getElementById("tab-name-a")?.textContent || "My Family",  value: 0, total: 0 },
      b: { name: document.getElementById("tab-name-b")?.textContent || "Her Family", value: 0, total: 0 },
    },
    topItems: [],
  };

  CATEGORIES.forEach(c => { d.byCategory[c.id] = { count: 0, value: 0 }; });
  STATUSES.forEach(s   => { d.byStatus[s.id]   = 0; });

  ["a", "b"].forEach(fam => {
    Object.values(cache[fam] || {}).forEach(member => {
      Object.entries(member.items || {}).forEach(([, item]) => {
        const status = getItemStatus(item);
        const price  = parseFloat(item.price) || 0;
        const cat    = item.category || "other";

        d.total++;
        d.byFamily[fam].total++;
        d.byStatus[status] = (d.byStatus[status] || 0) + 1;

        if (status === "want" || status === "sale") {
          d.wishlist++;
          d.topItems.push({ ...item, _fam: fam, _price: price, _member: member.name });
        } else if (status === "purchased") {
          d.purchased++;
        } else if (status === "cancelled") {
          d.cancelled++;
        }

        if (status !== "cancelled") {
          d.totalValue += price;
          d.byFamily[fam].value += price;
          if (d.byCategory[cat]) {
            d.byCategory[cat].count++;
            d.byCategory[cat].value += price;
          }
        }
      });
    });
  });

  d.topItems.sort((a, b) => b._price - a._price);
  d.topItems = d.topItems.slice(0, 6);
  return d;
}

function renderDashboard() {
  const panel = document.getElementById("panel-dash");
  if (!panel) return;

  const d      = getDashboardData();
  const maxCat = Math.max(...Object.values(d.byCategory).map(c => c.count), 1);
  const maxSt  = Math.max(...Object.values(d.byStatus), 1);
  const famSum = (d.byFamily.a.value + d.byFamily.b.value) || 1;
  const shortStatus = { want: "Want", sale: "For Sale", purchased: "Purchased", cancelled: "Cancelled" };
  const statAccents = ["var(--primary)", "var(--secondary)", "var(--success)", "var(--warning)"];

  const statCards = [
    { emoji: "🛍️", value: d.total,                        label: "Total Items" },
    { emoji: "💝",  value: d.wishlist,                     label: "On Wishlist"  },
    { emoji: "✅",  value: d.purchased,                    label: "Purchased"    },
    { emoji: "💰",  value: "$" + d.totalValue.toFixed(2), label: "Total Value"  },
  ];

  const catRows = CATEGORIES.map(c => {
    const info = d.byCategory[c.id] || { count: 0, value: 0 };
    const w    = Math.round((info.count / maxCat) * 100);
    const col  = CAT_COLORS[c.id] || "var(--primary)";
    return `
      <div class="dash-cat-row">
        <div class="dash-cat-info">
          <span class="dash-cat-emoji">${c.emoji}</span>
          <span class="dash-cat-name">${c.label}</span>
        </div>
        <div class="dash-bar-outer">
          <div class="dash-bar-inner" style="width:0%;background:${col}" data-w="${w}"></div>
        </div>
        <div class="dash-cat-meta">
          <span class="dash-cat-count">${info.count}</span>
          <span class="dash-cat-value">$${info.value.toFixed(0)}</span>
        </div>
      </div>`;
  }).join("");

  const statusRows = STATUSES.map(s => {
    const count = d.byStatus[s.id] || 0;
    const pct   = Math.round((count / (d.total || 1)) * 100);
    const w     = Math.round((count / maxSt) * 100);
    return `
      <div class="dash-status-row">
        <span class="dash-status-emoji">${s.emoji}</span>
        <span class="dash-status-label">${shortStatus[s.id]}</span>
        <div class="dash-bar-outer">
          <div class="dash-bar-inner" style="width:0%;background:${s.color}" data-w="${w}"></div>
        </div>
        <span class="dash-status-count">${count}</span>
        <span class="dash-status-pct">${pct}%</span>
      </div>`;
  }).join("");

  const famRows = ["a", "b"].map(fam => {
    const f   = d.byFamily[fam];
    const w   = Math.round((f.value / famSum) * 100);
    const col = fam === "a" ? "var(--primary)" : "var(--secondary)";
    return `
      <div class="dash-family-row">
        <div class="dash-family-dot" style="background:${col}"></div>
        <span class="dash-family-name">${esc(f.name)}</span>
        <div class="dash-family-bar-wrap">
          <div class="dash-family-bar" style="width:0%;background:${col}" data-w="${w}"></div>
        </div>
        <span class="dash-family-value">$${f.value.toFixed(2)}</span>
        <span class="dash-family-pct">${w}%</span>
      </div>`;
  }).join("");

  const topHtml = d.topItems.length === 0
    ? `<p class="dash-empty">No wishlist items yet — start adding products!</p>`
    : d.topItems.map(item => {
        const cat    = catById(item.category);
        const stInfo = statusById(getItemStatus(item));
        const thumb  = item.imageUrl
          ? `<img class="dash-top-thumb" src="${esc(item.imageUrl)}" alt="" onerror="this.style.display='none'">`
          : `<div class="dash-top-thumb dash-top-placeholder">${cat.emoji}</div>`;
        return `
          <div class="dash-top-item">
            ${thumb}
            <div class="dash-top-details">
              <div class="dash-top-name">${esc(item.text)}</div>
              <div class="dash-top-meta">
                <span>${cat.emoji} ${cat.label}</span>
                <span class="dash-top-sep">·</span>
                <span>${esc(item._member)}</span>
              </div>
            </div>
            <div class="dash-top-right">
              <div class="dash-top-price">$${esc(item.price)}</div>
              <div class="dash-top-status" style="background:${stInfo.bg};color:${stInfo.color}">${stInfo.emoji} ${stInfo.label}</div>
            </div>
          </div>`;
      }).join("");

  document.getElementById("dash-content").innerHTML = `
    <section class="dash-section">
      <p class="dash-section-title">Overview</p>
      <div class="dash-stats-grid">
        ${statCards.map((s, i) => `
          <div class="dash-stat-card" style="--stat-accent:${statAccents[i]}">
            <span class="dash-stat-icon">${s.emoji}</span>
            <div class="dash-stat-value" style="color:${statAccents[i]}">${s.value}</div>
            <div class="dash-stat-label">${s.label}</div>
          </div>`).join("")}
      </div>
    </section>

    <div class="dash-card">
      <p class="dash-card-title">Family Split</p>
      <div class="dash-family-rows">${famRows}</div>
    </div>

    <div class="dash-card">
      <p class="dash-card-title">By Category</p>
      <div class="dash-cat-list">${catRows}</div>
    </div>

    <div class="dash-card">
      <p class="dash-card-title">Status Breakdown</p>
      <div class="dash-status-list">${statusRows}</div>
    </div>

    <div class="dash-card">
      <p class="dash-card-title">Top Wishlist Items · by price</p>
      <div class="dash-top-list">${topHtml}</div>
    </div>`;

  // Animate all bars after paint
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll("#dash-content [data-w]").forEach(el => {
      el.style.width = el.dataset.w + "%";
    });
  }));
}

document.getElementById("tab-dash").addEventListener("click", () => {
  switchFamily("dash");
  renderDashboard();
});

// ── Ticket Seed Data ──────────────────────────────────────────────

const TICKET_FLIGHTS = {
  leg1: {
    dest: "Dubai, UAE",
    ts: new Date("2026-10-29T14:55:00").getTime(),
    flightno: "EK 242",
    notes: "Toronto Pearson (YYZ) Terminal 1 → Dubai Terminal 3"
  },
  leg2: {
    dest: "Ahmedabad, India",
    ts: new Date("2026-10-30T22:50:00").getTime(),
    flightno: "EK 538",
    notes: "Dubai Terminal 3 → Ahmedabad Terminal 2"
  },
  leg3: {
    dest: "Dubai, UAE (Return)",
    ts: new Date("2026-12-07T04:30:00").getTime(),
    flightno: "EK 539",
    notes: "Ahmedabad Terminal 2 → Dubai Terminal 3"
  },
  leg4: {
    dest: "Toronto, Canada (Return)",
    ts: new Date("2026-12-08T03:30:00").getTime(),
    flightno: "EK 241",
    notes: "Dubai Terminal 3 → Toronto Pearson (YYZ) Terminal 1"
  }
};

const TICKET_BOOKING = {
  ref: "EQBXG6",
  ticketNo: "176 2213463336",
  skywardsNo: "EK761050802",
  class: "Economy Saver",
  passengers: [
    { name: "PATEL / NAMANKUMAR MR", fare: "CAD $2,175.33", baggage: "2 × 23kg checked + 7kg carry-on" },
    { name: "PATEL / DISHABEN MS", fare: "CAD $2,175.33", baggage: "2 × 23kg checked + 7kg carry-on" }
  ],
  totalFare: "CAD $4,570.72",
  baggageAllowance: "2 × 23kg checked + 7kg carry-on (per person)"
};

async function seedFlightsIfEmpty() {
  const snap = await new Promise(resolve => {
    const unsub = onValue(ref(db, `${DB_ROOT}/flights`), s => { unsub(); resolve(s); });
  });
  if (snap.val()) return;
  for (const leg of Object.values(TICKET_FLIGHTS)) {
    await push(ref(db, `${DB_ROOT}/flights`), leg);
  }
}

async function seedBookingIfEmpty() {
  const snap = await new Promise(resolve => {
    const unsub = onValue(ref(db, `${DB_ROOT}/booking`), s => { unsub(); resolve(s); });
  });
  if (snap.val()) return;
  await set(ref(db, `${DB_ROOT}/booking`), TICKET_BOOKING);
}

seedFlightsIfEmpty();
seedBookingIfEmpty();

// ── Booking Info ──────────────────────────────────────────────────

let bookingCache = {};

onValue(ref(db, `${DB_ROOT}/booking`), snap => {
  bookingCache = snap.val() || {};
  renderBookingInfo();
});

function renderBookingInfo() {
  const section = document.getElementById("booking-section");
  if (!section || !bookingCache.ref) {
    if (section) section.innerHTML = "";
    return;
  }

  const f = bookingCache;
  const passengers = f.passengers || [{ name: f.passenger, fare: f.totalFare, baggage: f.baggageAllowance }];

  const passengerCards = passengers.map(p => `
    <div class="booking-passenger">
      <div class="booking-passenger-name">${esc(p.name)}</div>
      <div class="booking-passenger-grid">
        <div class="booking-field">
          <div class="booking-field-label">Fare</div>
          <div class="booking-field-value">${esc(p.fare || "")}</div>
        </div>
        <div class="booking-field">
          <div class="booking-field-label">Baggage</div>
          <div class="booking-field-value">${esc(p.baggage || "")}</div>
        </div>
      </div>
    </div>
  `).join("");

  section.innerHTML = `
    <div class="booking-card">
      <div class="booking-header">
        <span class="booking-icon">✈️</span>
        <span class="booking-title">Flight Booking</span>
      </div>
      <div class="booking-shared">
        <div class="booking-field">
          <div class="booking-field-label">Booking Ref</div>
          <div class="booking-field-value booking-pnr">${esc(f.ref || "")}</div>
        </div>
        <div class="booking-field">
          <div class="booking-field-label">Ticket Number</div>
          <div class="booking-field-value">${esc(f.ticketNo || "")}</div>
        </div>
        <div class="booking-field">
          <div class="booking-field-label">Class</div>
          <div class="booking-field-value">${esc(f.class || "")}</div>
        </div>
        <div class="booking-field">
          <div class="booking-field-label">Total Fare</div>
          <div class="booking-field-value booking-total">${esc(f.totalFare || "")}</div>
        </div>
      </div>
      <div class="booking-passengers">${passengerCards}</div>
    </div>`;
}

// ── Baggage Tracker ───────────────────────────────────────────────

let baggageCache = {};
let selectedBagType = "checked";

onValue(ref(db, `${DB_ROOT}/baggage`), snap => {
  baggageCache = snap.val() || {};
  renderBaggageTracker();
});

function calcBaggageWeight() {
  let total = 0;
  Object.values(baggageCache).forEach(item => {
    total += parseFloat(item.weight) || 0;
  });
  return total;
}

function calcBaggageByType(type) {
  let total = 0;
  Object.values(baggageCache).forEach(item => {
    if (item.type === type) total += parseFloat(item.weight) || 0;
  });
  return total;
}

function renderBaggageTracker() {
  const section = document.getElementById("baggage-section");
  if (!section) return;

  const checkedUsed = calcBaggageByType("checked");
  const carryUsed   = calcBaggageByType("carry");
  const checkedMax  = 46; // 2 × 23kg
  const carryMax    = 7;
  const checkedPct  = Math.min((checkedUsed / checkedMax) * 100, 100);
  const carryPct    = Math.min((carryUsed / carryMax) * 100, 100);

  const checkedOver = checkedUsed > checkedMax;
  const carryOver   = carryUsed > carryMax;

  const items = Object.entries(baggageCache)
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));

  const itemsHtml = items.length === 0
    ? `<p class="bag-empty">No items packed yet — start adding!</p>`
    : items.map(([id, item]) => {
        const typeInfo = { checked: "🧳 Checked", carry: "🎒 Carry-on", extra: "📦 Extra" }[item.type] || "🧳 Checked";
        return `
          <div class="bag-item">
            <div class="bag-item-info">
              <div class="bag-item-name">${esc(item.name)}</div>
              <div class="bag-item-meta">
                <span class="bag-item-type">${typeInfo}</span>
                <span class="bag-item-weight">${esc(item.weight)} kg</span>
              </div>
            </div>
            <button class="bag-item-del" data-del-bag="${id}" title="Remove">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
              </svg>
            </button>
          </div>`;
      }).join("");

  section.innerHTML = `
    <div class="baggage-card">
      <div class="baggage-header">
        <span class="baggage-icon">🧳</span>
        <span class="baggage-title">Baggage Tracker</span>
        <button class="baggage-add-btn" id="baggage-add-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Item
        </button>
      </div>

      <div class="baggage-bars">
        <div class="baggage-bar-group">
          <div class="baggage-bar-label">
            <span>🧳 Checked</span>
            <span class="baggage-bar-num ${checkedOver ? "over" : ""}">${checkedUsed.toFixed(1)} / ${checkedMax} kg</span>
          </div>
          <div class="baggage-bar-track">
            <div class="baggage-bar-fill ${checkedOver ? "over" : ""}" style="width:${checkedPct}%"></div>
          </div>
        </div>
        <div class="baggage-bar-group">
          <div class="baggage-bar-label">
            <span>🎒 Carry-on</span>
            <span class="baggage-bar-num ${carryOver ? "over" : ""}">${carryUsed.toFixed(1)} / ${carryMax} kg</span>
          </div>
          <div class="baggage-bar-track">
            <div class="baggage-bar-fill ${carryOver ? "over" : ""}" style="width:${carryPct}%"></div>
          </div>
        </div>
      </div>

      <div class="baggage-items">${itemsHtml}</div>
    </div>`;

  document.getElementById("baggage-add-btn")?.addEventListener("click", openBaggageModal);

  section.querySelectorAll("[data-del-bag]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!confirm("Remove this baggage item?")) return;
      remove(ref(db, `${DB_ROOT}/baggage/${btn.dataset.delBag}`));
    });
  });
}

function openBaggageModal() {
  selectedBagType = "checked";
  document.getElementById("bag-item-name").value = "";
  document.getElementById("bag-weight").value = "";
  document.getElementById("bag-type-row").querySelectorAll(".bag-type-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.bagtype === "checked");
  });
  document.getElementById("baggage-modal").classList.add("open");
  setTimeout(() => document.getElementById("bag-item-name").focus({ preventScroll: true }), 80);
}

function closeBaggageModal() {
  document.getElementById("baggage-modal").classList.remove("open");
}

async function submitBaggageModal() {
  const name = document.getElementById("bag-item-name").value.trim();
  const weight = document.getElementById("bag-weight").value.trim();

  if (!name) { document.getElementById("bag-item-name").focus(); return; }
  if (!weight || parseFloat(weight) <= 0) { document.getElementById("bag-weight").focus(); return; }

  const btn = document.getElementById("baggage-modal-submit");
  btn.disabled = true;

  await push(ref(db, `${DB_ROOT}/baggage`), {
    name, weight, type: selectedBagType, createdAt: Date.now()
  });

  btn.disabled = false;
  closeBaggageModal();
}

document.getElementById("baggage-modal-close")?.addEventListener("click", closeBaggageModal);
document.getElementById("baggage-modal-cancel")?.addEventListener("click", closeBaggageModal);
document.getElementById("baggage-modal-submit")?.addEventListener("click", submitBaggageModal);
document.getElementById("baggage-modal")?.addEventListener("click", e => {
  if (e.target.id === "baggage-modal") closeBaggageModal();
});

document.getElementById("bag-type-row")?.addEventListener("click", e => {
  const btn = e.target.closest(".bag-type-btn");
  if (!btn) return;
  selectedBagType = btn.dataset.bagtype;
  document.querySelectorAll("#bag-type-row .bag-type-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.bagtype === selectedBagType);
  });
});

document.getElementById("bag-item-name")?.addEventListener("keydown", e => { if (e.key === "Enter") submitBaggageModal(); });
document.getElementById("bag-weight")?.addEventListener("keydown", e => { if (e.key === "Enter") submitBaggageModal(); });

// ── Flight Countdown ──────────────────────────────────────────────

let flightsCache = {};
let cdInterval   = null;
let flightCtx    = { mode: "add", id: null };

// Firebase listener
onValue(ref(db, `${DB_ROOT}/flights`), snap => {
  flightsCache = snap.val() || {};
  renderFlights();
});

function renderFlights() {
  const section = document.getElementById("flight-section");
  if (!section) return;

  const flights = Object.entries(flightsCache)
    .map(([id, f]) => ({ id, ...f }))
    .sort((a, b) => a.ts - b.ts);

  if (!flights.length) {
    section.innerHTML = `<button class="flight-empty-btn" id="flight-add-btn">
      <span>✈️</span> Add flight countdown
    </button>`;
    document.getElementById("flight-add-btn").addEventListener("click", () => openFlightModal());
    stopCountdown();
    return;
  }

  section.innerHTML = flights.map(f => buildFlightCard(f)).join("") +
    `<button class="flight-add-more" id="flight-add-btn">+ Add another flight</button>`;

  document.getElementById("flight-add-btn").addEventListener("click", () => openFlightModal());

  section.querySelectorAll("[data-flight-edit]").forEach(btn => {
    btn.addEventListener("click", () => openFlightModal(btn.dataset.flightEdit));
  });
  section.querySelectorAll("[data-flight-del]").forEach(btn => {
    btn.addEventListener("click", () => deleteFlight(btn.dataset.flightDel));
  });

  startCountdown();
}

function buildFlightCard(f) {
  const now  = Date.now();
  const diff = f.ts - now;
  const past = diff <= 0;

  const dateStr = new Date(f.ts).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    year: "numeric", hour: "2-digit", minute: "2-digit"
  });

  const countdownHtml = past
    ? `<div class="fc-departed">✈️ &nbsp;Flight departed</div>`
    : `<div class="fc-countdown" data-ts="${f.ts}">${buildCountdownHtml(diff)}</div>`;

  // Departure reminders
  let remindersHtml = "";
  if (!past) {
    const msDiff  = f.ts - now;
    const hoursLeft = msDiff / (1000 * 60 * 60);
    const reminders = [];

    reminders.push({ time: "Check-in opens", offset: -2, emoji: "📋", unit: "hrs before" });
    reminders.push({ time: "Go through passport control", offset: -1.5, emoji: "🛂", unit: "hrs before" });
    reminders.push({ time: "Be at gate (Economy)", offset: -1, emoji: "🚪", unit: "hr before" });
    reminders.push({ time: "Boarding starts", offset: -0.5, emoji: "🎟️", unit: "mins before" });

    reminders.forEach(r => {
      const hoursUntil = r.offset * -1;
      let status = "upcoming";
      if (hoursLeft > hoursUntil) status = "passed";
      else if (hoursLeft > hoursUntil - 0.5) status = "next";

      remindersHtml += `<div class="fc-reminder ${status}">
        <span class="fc-reminder-emoji">${r.emoji}</span>
        <span class="fc-reminder-text">${r.time}</span>
        <span class="fc-reminder-time">${hoursUntil >= 1 ? hoursUntil + "h" : Math.round(hoursUntil * 60) + "m"} before</span>
      </div>`;
    });
  }

  const flightno = f.flightno ? `<div class="fc-flightno">${escHtml(f.flightno)}</div>` : "";
  const notes    = f.notes    ? `<span class="fc-notes">${escHtml(f.notes)}</span>` : "";

  return `<div class="flight-card${past ? " fc-past" : ""}">
    <div class="fc-top">
      <div class="fc-dest-wrap">
        <div class="fc-plane">✈️</div>
        <div>
          <div class="fc-dest">${escHtml(f.dest)}</div>
          ${flightno}
        </div>
      </div>
      <div class="fc-actions">
        <button class="fc-btn" data-flight-edit="${f.id}" title="Edit">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
            <path d="m15 5 4 4"/>
          </svg>
        </button>
        <button class="fc-btn" data-flight-del="${f.id}" title="Delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
    ${countdownHtml}
    ${remindersHtml ? `<div class="fc-reminders">${remindersHtml}</div>` : ""}
    <div class="fc-date">${dateStr}${notes}</div>
  </div>`;
}

function buildCountdownHtml(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const d  = Math.floor(totalSec / 86400);
  const h  = Math.floor((totalSec % 86400) / 3600);
  const m  = Math.floor((totalSec % 3600) / 60);
  const s  = totalSec % 60;

  const pad = n => String(n).padStart(2, "0");

  return `<div class="cd-units">
    <div class="cd-unit">
      <div class="cd-box"><span class="cd-num">${pad(d)}</span></div>
      <span class="cd-lbl">Days</span>
    </div>
    <span class="cd-sep">:</span>
    <div class="cd-unit">
      <div class="cd-box"><span class="cd-num">${pad(h)}</span></div>
      <span class="cd-lbl">Hours</span>
    </div>
    <span class="cd-sep">:</span>
    <div class="cd-unit">
      <div class="cd-box"><span class="cd-num">${pad(m)}</span></div>
      <span class="cd-lbl">Mins</span>
    </div>
    <span class="cd-sep">:</span>
    <div class="cd-unit">
      <div class="cd-box"><span class="cd-num">${pad(s)}</span></div>
      <span class="cd-lbl">Secs</span>
    </div>
  </div>`;
}

function tickCountdown() {
  const now = Date.now();
  document.querySelectorAll(".fc-countdown[data-ts]").forEach(el => {
    const diff = parseInt(el.dataset.ts) - now;
    if (diff <= 0) {
      renderFlights();
    } else {
      el.innerHTML = buildCountdownHtml(diff);
    }
  });
}

function startCountdown() {
  stopCountdown();
  const hasFuture = Object.values(flightsCache).some(f => f.ts > Date.now());
  if (hasFuture) cdInterval = setInterval(tickCountdown, 1000);
}

function stopCountdown() {
  if (cdInterval) { clearInterval(cdInterval); cdInterval = null; }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") startCountdown();
  else stopCountdown();
});

function openFlightModal(id) {
  flightCtx = id ? { mode: "edit", id } : { mode: "add", id: null };
  const f   = id ? flightsCache[id] : null;

  document.getElementById("flight-modal-title").textContent = id ? "Edit Flight" : "Add Flight";
  document.getElementById("flight-modal-submit").textContent = id ? "Save Changes" : "Save Flight";

  if (f) {
    document.getElementById("flight-dest").value  = f.dest     || "";
    document.getElementById("flight-no").value    = f.flightno || "";
    document.getElementById("flight-notes").value = f.notes    || "";
    const d = new Date(f.ts);
    document.getElementById("flight-date").value  = d.toLocaleDateString("en-CA"); // YYYY-MM-DD
    document.getElementById("flight-time").value  = d.toTimeString().slice(0, 5);  // HH:MM
  } else {
    document.getElementById("flight-dest").value  = "";
    document.getElementById("flight-no").value    = "";
    document.getElementById("flight-notes").value = "";
    document.getElementById("flight-date").value  = "";
    document.getElementById("flight-time").value  = "";
  }

  document.getElementById("flight-modal").classList.add("open");
  setTimeout(() => document.getElementById("flight-dest").focus({ preventScroll: true }), 80);
}

function closeFlightModal() {
  document.getElementById("flight-modal").classList.remove("open");
}

async function submitFlightModal() {
  const dest = document.getElementById("flight-dest").value.trim();
  const date = document.getElementById("flight-date").value;
  const time = document.getElementById("flight-time").value;

  if (!dest)       { alert("Please enter a destination."); return; }
  if (!date || !time) { alert("Please enter both date and time."); return; }

  const ts = new Date(`${date}T${time}`).getTime();
  if (isNaN(ts))  { alert("Invalid date or time."); return; }

  const payload = {
    dest,
    ts,
    flightno: document.getElementById("flight-no").value.trim(),
    notes:    document.getElementById("flight-notes").value.trim(),
  };

  const btn = document.getElementById("flight-modal-submit");
  btn.disabled = true;

  try {
    if (flightCtx.mode === "edit") {
      await update(ref(db, `${DB_ROOT}/flights/${flightCtx.id}`), payload);
    } else {
      await push(ref(db, `${DB_ROOT}/flights`), payload);
    }
    closeFlightModal();
  } catch (e) {
    alert("Failed to save. Please try again.");
  } finally {
    btn.disabled = false;
  }
}

async function deleteFlight(id) {
  if (!confirm("Remove this flight countdown?")) return;
  await remove(ref(db, `${DB_ROOT}/flights/${id}`));
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

document.getElementById("flight-modal-close").addEventListener("click", closeFlightModal);
document.getElementById("flight-modal-cancel").addEventListener("click", closeFlightModal);
document.getElementById("flight-modal").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeFlightModal();
});
document.getElementById("flight-modal-submit").addEventListener("click", submitFlightModal);
document.getElementById("flight-dest").addEventListener("keydown", e => {
  if (e.key === "Enter") submitFlightModal();
});
