/* =============================================================
   TSA International School, Rawatsar — Admin Dashboard JS
   ============================================================= */

(function () {
    "use strict";

    const API = window.SCHOOL_API || "http://127.0.0.1:8000";
    const TOKEN_KEY = "tsa_admin_token";
    const USER_KEY = "tsa_admin_user";

    const token = localStorage.getItem(TOKEN_KEY);
    let user = null;

    try {
        user = JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch (err) {
        user = null;
    }

    if (!token || !user || !["admin", "teacher"].includes(user.role)) {
        window.location.replace("index.html");
        return;
    }

    const viewEl = document.getElementById("view");
    const pageTitle = document.getElementById("pageTitle");

    /* ---------------------------------------------------------
       1. Small helpers
    --------------------------------------------------------- */
    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        }[c]));
    }

    function fmtDate(value) {
        if (!value) return "—";
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return "—";
        return parsed.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        });
    }

    function fmtDateTime(value) {
        if (!value) return "—";
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return "—";
        return parsed.toLocaleString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    function badge(text, cls) {
        return `<span class="badge ${esc(cls)}">${esc(text)}</span>`;
    }

    function initials(name) {
        const parts = String(name || "A").trim().split(/\s+/);
        return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "A";
    }

    function toast(message, type) {
        const el = document.createElement("div");
        el.className = "toast " + (type === "error" ? "error" : "ok");
        el.textContent = message;
        document.body.append(el);
        window.setTimeout(() => el.remove(), 3500);
    }

    function table(headers, rowsHtml) {
        if (!rowsHtml.length) {
            return `<p class="empty">No records found yet.</p>`;
        }
        return `<div class="table-wrap"><table><thead><tr>${headers
            .map((h) => `<th>${esc(h)}</th>`)
            .join("")}</tr></thead><tbody>${rowsHtml.join("")}</tbody></table></div>`;
    }

    /* ---------------------------------------------------------
       2. API client
    --------------------------------------------------------- */
    function describeError(data) {
        const detail = data && data.detail;
        if (typeof detail === "string") return detail;
        if (Array.isArray(detail)) {
            return detail
                .map((d) => `${(d.loc && d.loc[d.loc.length - 1]) || "field"}: ${d.msg}`)
                .join(", ");
        }
        return "Request failed. Please try again.";
    }

    function clearSession() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        window.location.replace("index.html");
    }

    async function api(path, options) {
        const opts = options || {};
        const headers = { Authorization: `Bearer ${token}` };

        if (opts.body !== undefined) {
            headers["Content-Type"] = "application/json";
        }

        let response;
        try {
            response = await fetch(API + path, {
                method: opts.method || "GET",
                headers,
                body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
            });
        } catch (err) {
            throw new Error(`Cannot reach the server at ${API}. Is the backend running?`);
        }

        if (response.status === 401) {
            toast("Session expired. Please sign in again.", "error");
            clearSession();
            throw new Error("Session expired");
        }

        if (!response.ok) {
            let data = null;
            try {
                data = await response.json();
            } catch (ignored) {
                // non-JSON error
            }
            throw new Error(describeError(data));
        }

        if (response.status === 204) return null;
        return response.json();
    }

    /* ---------------------------------------------------------
       3. Modal
    --------------------------------------------------------- */
    function escClose(event) {
        if (event.key === "Escape") closeModal();
    }

    function closeModal() {
        const existing = document.querySelector(".modal-backdrop");
        if (existing) existing.remove();
        document.removeEventListener("keydown", escClose);
    }

    function openModal(title, bodyHtml, footerHtml) {
        closeModal();

        const backdrop = document.createElement("div");
        backdrop.className = "modal-backdrop";
        backdrop.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true">
                <div class="modal-head">
                    <h2>${esc(title)}</h2>
                    <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
                </div>
                <div class="modal-body">${bodyHtml}</div>
                ${footerHtml ? `<div class="modal-foot">${footerHtml}</div>` : ""}
            </div>`;
        document.body.append(backdrop);

        backdrop.addEventListener("click", (event) => {
            if (event.target === backdrop || event.target.closest("[data-close]")) {
                closeModal();
            }
        });
        document.addEventListener("keydown", escClose);

        return backdrop;
    }

    function fieldHtml(field, value) {
        const current = value ?? field.default ?? "";
        const required = field.required ? "required" : "";
        const full = field.full || field.type === "textarea" || field.type === "checkbox"
            ? " full"
            : "";
        const id = `f-${field.name}`;

        if (field.type === "textarea") {
            return `<label class="field${full}"><span>${esc(field.label)}</span>
                <textarea id="${id}" name="${field.name}" rows="${field.rows || 4}" ${required}>${esc(current)}</textarea></label>`;
        }

        if (field.type === "checkbox") {
            return `<label class="field check${full}">
                <input type="checkbox" id="${id}" name="${field.name}" ${current ? "checked" : ""}>
                <span>${esc(field.label)}</span></label>`;
        }

        if (field.type === "select") {
            const options = field.options
                .map((raw) => (typeof raw === "string" ? { value: raw, label: raw } : raw))
                .map(
                    (o) => `<option value="${esc(o.value)}" ${String(o.value) === String(current) ? "selected" : ""}>${esc(o.label)}</option>`
                )
                .join("");
            return `<label class="field${full}"><span>${esc(field.label)}</span>
                <select id="${id}" name="${field.name}" ${required}>${options}</select></label>`;
        }

        const placeholder = field.placeholder
            ? ` placeholder="${esc(field.placeholder)}"`
            : "";
        const min = field.min !== undefined ? ` min="${field.min}"` : "";

        return `<label class="field${full}"><span>${esc(field.label)}</span>
            <input type="${field.type || "text"}" id="${id}" name="${field.name}" value="${esc(current)}" ${required}${placeholder}${min}></label>`;
    }

    function openForm(cfg, values, onSave) {
        openModal(
            cfg.title,
            `<form id="resourceForm" class="form-grid" novalidate>${cfg.fields
                .map((f) => fieldHtml(f, values[f.name]))
                .join("")}</form>`,
            `<button type="button" class="btn ghost" data-close>Cancel</button>
             <button type="submit" class="btn primary" form="resourceForm">${esc(cfg.submitLabel || "Save")}</button>`
        );

        document.getElementById("resourceForm").addEventListener("submit", async (event) => {
            event.preventDefault();

            const data = {};

            for (const field of cfg.fields) {
                const input = event.target.elements[field.name];
                let value;

                if (field.type === "checkbox") {
                    value = input.checked;
                } else {
                    value = input.value.trim();
                    if (value === "") value = field.required ? "" : null;
                    if (field.type === "number" && value !== null) value = Number(value);
                }

                if (field.required && (value === "" || value === null)) {
                    toast(`${field.label} is required`, "error");
                    input.focus();
                    return;
                }

                data[field.name] = value;
            }

            try {
                await onSave(data);
                closeModal();
                toast("Saved successfully");
            } catch (err) {
                toast(err.message, "error");
            }
        });
    }

    /* ---------------------------------------------------------
       4. Generic content resources (News, Notices, ...)
    --------------------------------------------------------- */
    const RESOURCES = {
        news: {
            title: "News",
            singular: "News Post",
            endpoint: "/api/admin/news",
            description: "School news articles shown on the website.",
            columns: [
                { label: "Title", render: (r) => `<span class="cell-title">${esc(r.title)}</span><span class="cell-sub">${esc(r.summary || "")}</span>` },
                { label: "Status", render: (r) => badge(r.is_published ? "Published" : "Draft", r.is_published ? "ok" : "muted") },
                { label: "Date", render: (r) => fmtDate(r.published_at) },
            ],
            fields: [
                { name: "title", label: "Title", required: true },
                { name: "image_url", label: "Image URL", placeholder: "https://…", full: true },
                { name: "summary", label: "Summary", type: "textarea", rows: 2, full: true },
                { name: "content", label: "Content", type: "textarea", rows: 6, required: true, full: true },
                { name: "is_published", label: "Published on website", type: "checkbox", default: true },
            ],
        },
        notices: {
            title: "Notices",
            singular: "Notice",
            endpoint: "/api/admin/notices",
            description: "Short announcements for students and parents.",
            columns: [
                { label: "Title", render: (r) => `<span class="cell-title">${esc(r.title)}</span><span class="cell-sub">${esc(String(r.message || "").slice(0, 80))}</span>` },
                { label: "Status", render: (r) => badge(r.is_active ? "Active" : "Hidden", r.is_active ? "ok" : "muted") },
                { label: "Date", render: (r) => fmtDate(r.created_at) },
            ],
            fields: [
                { name: "title", label: "Title", required: true },
                { name: "is_active", label: "Active on website", type: "checkbox", default: true },
                { name: "message", label: "Message", type: "textarea", rows: 5, required: true, full: true },
            ],
        },
        events: {
            title: "Events",
            singular: "Event",
            endpoint: "/api/admin/events",
            description: "Upcoming school events shown on the website.",
            columns: [
                { label: "Event", render: (r) => `<span class="cell-title">${esc(r.title)}</span><span class="cell-sub">${esc(r.location || "")}</span>` },
                { label: "Date", render: (r) => fmtDate(r.event_date) },
                { label: "Status", render: (r) => badge(r.is_active ? "Active" : "Hidden", r.is_active ? "ok" : "muted") },
            ],
            fields: [
                { name: "title", label: "Title", required: true },
                { name: "event_date", label: "Event date", type: "date", required: true },
                { name: "location", label: "Location" },
                { name: "image_url", label: "Image URL", placeholder: "https://…", full: true },
                { name: "description", label: "Description", type: "textarea", rows: 4, full: true },
                { name: "is_active", label: "Active on website", type: "checkbox", default: true },
            ],
        },
        gallery: {
            title: "Gallery",
            singular: "Gallery Item",
            endpoint: "/api/admin/gallery",
            description: "Photos shown in the website gallery. Use direct image URLs.",
            columns: [
                { label: "Image", render: (r) => `<img class="thumb" src="${esc(r.image_url)}" alt="" loading="lazy">` },
                { label: "Title", render: (r) => `<span class="cell-title">${esc(r.title)}</span><span class="cell-sub">${esc(r.category)}</span>` },
                { label: "Order", render: (r) => esc(r.sort_order) },
                { label: "Status", render: (r) => badge(r.is_active ? "Active" : "Hidden", r.is_active ? "ok" : "muted") },
            ],
            fields: [
                { name: "title", label: "Title", required: true },
                { name: "category", label: "Category", placeholder: "Sports, Events, Campus…" },
                { name: "image_url", label: "Image URL", required: true, placeholder: "https://…", full: true },
                { name: "sort_order", label: "Sort order", type: "number", default: 0 },
                { name: "is_active", label: "Active on website", type: "checkbox", default: true },
            ],
        },
        faculty: {
            title: "Faculty",
            singular: "Faculty Member",
            endpoint: "/api/admin/faculty",
            description: "Teachers shown on the website faculty section.",
            columns: [
                { label: "Name", render: (r) => `<span class="cell-title">${esc(r.name)}</span><span class="cell-sub">${esc(r.designation)}</span>` },
                { label: "Subject", render: (r) => esc(r.subject || "—") },
                { label: "Order", render: (r) => esc(r.sort_order) },
                { label: "Status", render: (r) => badge(r.is_active ? "Active" : "Hidden", r.is_active ? "ok" : "muted") },
            ],
            fields: [
                { name: "name", label: "Name", required: true },
                { name: "designation", label: "Designation", required: true, placeholder: "Senior Teacher, Coordinator…" },
                { name: "subject", label: "Subject" },
                { name: "image_url", label: "Photo URL", placeholder: "https://…", full: true },
                { name: "sort_order", label: "Sort order", type: "number", default: 0 },
                { name: "bio", label: "Short bio", type: "textarea", rows: 3, full: true },
                { name: "is_active", label: "Active on website", type: "checkbox", default: true },
            ],
        },
    };

    async function renderResource(key) {
        const cfg = RESOURCES[key];

        viewEl.innerHTML = `
            <div class="page-head">
                <div>
                    <h2>${esc(cfg.title)}</h2>
                    <p>${esc(cfg.description)}</p>
                </div>
                <button class="btn primary" id="addBtn">+ Add ${esc(cfg.singular)}</button>
            </div>
            <div class="card"><div id="resourceList"><p class="empty">Loading…</p></div></div>`;

        document.getElementById("addBtn").addEventListener("click", () => {
            const defaults = {};
            for (const f of cfg.fields) {
                if (f.default !== undefined) defaults[f.name] = f.default;
            }
            openForm(
                {
                    title: `Add ${cfg.singular}`,
                    fields: cfg.fields,
                    submitLabel: `Add ${cfg.singular}`,
                },
                defaults,
                async (data) => {
                    await api(cfg.endpoint, { method: "POST", body: data });
                    await renderResource(key);
                }
            );
        });

        const rows = await api(cfg.endpoint);
        const headers = cfg.columns.map((c) => c.label).concat("Actions");

        document.getElementById("resourceList").innerHTML = table(
            headers,
            rows.map(
                (row) => `<tr>
                    ${cfg.columns.map((c) => `<td>${c.render(row)}</td>`).join("")}
                    <td>
                        <div class="filter-row">
                            <button class="btn ghost sm" data-edit="${row.id}">Edit</button>
                            <button class="btn danger sm" data-del="${row.id}">Delete</button>
                        </div>
                    </td>
                </tr>`
            )
        );

        document.querySelectorAll("[data-edit]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const row = rows.find((r) => String(r.id) === btn.dataset.edit);
                openForm(
                    { title: `Edit ${cfg.singular}`, fields: cfg.fields, submitLabel: "Save Changes" },
                    row,
                    async (data) => {
                        await api(`${cfg.endpoint}/${row.id}`, { method: "PUT", body: data });
                        await renderResource(key);
                    }
                );
            });
        });

        document.querySelectorAll("[data-del]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                if (!window.confirm("Delete this item permanently?")) return;
                try {
                    await api(`${cfg.endpoint}/${btn.dataset.del}`, { method: "DELETE" });
                    toast("Deleted");
                    await renderResource(key);
                } catch (err) {
                    toast(err.message, "error");
                }
            });
        });
    }

    /* ---------------------------------------------------------
       5. Dashboard
    --------------------------------------------------------- */
    async function renderDashboard() {
        viewEl.innerHTML = `<div class="card"><p class="empty">Loading…</p></div>`;

        const stats = await api("/api/admin/dashboard");

        viewEl.innerHTML = `
            <div class="page-head">
                <div>
                    <h2>Welcome back, ${esc(user.full_name)}</h2>
                    <p>Here is what is happening on your school website.</p>
                </div>
            </div>

            <div class="stat-grid">
                <div class="card stat-card">
                    <span class="stat-icon navy">🎓</span>
                    <div><strong>${esc(stats.admissions.total)}</strong><span>Total admissions</span></div>
                </div>
                <div class="card stat-card">
                    <span class="stat-icon gold">🆕</span>
                    <div><strong>${esc(stats.admissions.new)}</strong><span>New applications</span></div>
                </div>
                <div class="card stat-card">
                    <span class="stat-icon red">✉️</span>
                    <div><strong>${esc(stats.messages.unread)}</strong><span>Unread messages</span></div>
                </div>
                <div class="card stat-card">
                    <span class="stat-icon green">📄</span>
                    <div><strong>${esc(stats.counts.news)}</strong><span>News posts</span></div>
                </div>
                ${
                    stats.management
                        ? `
                <div class="card stat-card">
                    <span class="stat-icon navy">👨‍🎓</span>
                    <div><strong>${esc(stats.management.students)}</strong><span>Active students</span></div>
                </div>
                <div class="card stat-card">
                    <span class="stat-icon green">✅</span>
                    <div><strong>${esc(stats.management.attendance_today.present)} / ${esc(stats.management.attendance_today.marked)}</strong><span>Present today</span></div>
                </div>
                <div class="card stat-card">
                    <span class="stat-icon gold">💰</span>
                    <div><strong>Rs ${Number(stats.management.fees.pending_amount || 0).toLocaleString()}</strong><span>Fees pending (${esc(stats.management.fees.unpaid_count)} vouchers)</span></div>
                </div>`
                        : ""
                }
            </div>

            <div class="section-grid">
                <div class="card">
                    <div class="card-head">
                        <h3>Recent admissions</h3>
                        <button class="btn ghost sm" data-go="admissions">View all</button>
                    </div>
                    ${table(
                        ["Student", "Class", "Status", "Received"],
                        stats.recent_admissions.map(
                            (a) => `<tr>
                                <td><span class="cell-title">${esc(a.student_name)}</span><span class="cell-sub">${esc(a.parent_name)}</span></td>
                                <td>${esc(a.class_name)}</td>
                                <td>${badge(a.status, a.status)}</td>
                                <td>${fmtDateTime(a.created_at)}</td>
                            </tr>`
                        )
                    )}
                </div>

                <div class="card">
                    <div class="card-head">
                        <h3>Recent messages</h3>
                        <button class="btn ghost sm" data-go="messages">View all</button>
                    </div>
                    ${table(
                        ["From", "Subject", "Status", "Date"],
                        stats.recent_messages.map(
                            (m) => `<tr>
                                <td><span class="cell-title">${esc(m.full_name)}</span></td>
                                <td>${esc(m.subject)}</td>
                                <td>${badge(m.is_read ? "Read" : "Unread", m.is_read ? "muted" : "new")}</td>
                                <td>${fmtDateTime(m.created_at)}</td>
                            </tr>`
                        )
                    )}
                </div>
            </div>`;

        viewEl.querySelectorAll("[data-go]").forEach((btn) => {
            btn.addEventListener("click", () => show(btn.dataset.go));
        });
    }

    /* ---------------------------------------------------------
       6. Admissions
    --------------------------------------------------------- */
    const STATUSES = ["new", "reviewing", "approved", "rejected"];

    async function renderAdmissions() {
        viewEl.innerHTML = `
            <div class="page-head">
                <div>
                    <h2>Admissions</h2>
                    <p>Applications submitted through the website form.</p>
                </div>
                <div class="filter-row">
                    <label for="statusFilter" class="muted">Filter</label>
                    <select id="statusFilter">
                        <option value="">All</option>
                        ${STATUSES.map((s) => `<option value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}
                    </select>
                </div>
            </div>
            <div class="card"><div id="admissionsList"><p class="empty">Loading…</p></div></div>`;

        const filter = document.getElementById("statusFilter");
        const target = document.getElementById("admissionsList");

        const load = async () => {
            target.innerHTML = `<p class="empty">Loading…</p>`;
            const query = filter.value ? `?status=${filter.value}` : "";
            const rows = await api(`/api/admissions${query}`);

            target.innerHTML = table(
                ["Student", "Class", "Contact", "Status", "Received", "Actions"],
                rows.map(
                    (a) => `<tr>
                        <td><span class="cell-title">${esc(a.student_name)}</span><span class="cell-sub">${esc(a.parent_name)}</span></td>
                        <td>${esc(a.class_name)}</td>
                        <td><span class="cell-title">${esc(a.parent_email)}</span><span class="cell-sub">${esc(a.phone)}</span></td>
                        <td>${badge(a.status, a.status)}</td>
                        <td>${fmtDateTime(a.created_at)}</td>
                        <td>
                            <div class="filter-row">
                                <select data-status="${a.id}">
                                    ${STATUSES.map(
                                        (s) => `<option value="${s}" ${a.status === s ? "selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`
                                    ).join("")}
                                </select>
                                <button class="btn danger sm" data-del="${a.id}">Delete</button>
                            </div>
                        </td>
                    </tr>`
                )
            );

            target.querySelectorAll("select[data-status]").forEach((select) => {
                select.addEventListener("change", async () => {
                    try {
                        await api(`/api/admissions/${select.dataset.status}`, {
                            method: "PATCH",
                            body: { status: select.value },
                        });
                        toast("Status updated");
                    } catch (err) {
                        toast(err.message, "error");
                    }
                });
            });

            target.querySelectorAll("[data-del]").forEach((btn) => {
                btn.addEventListener("click", async () => {
                    if (!window.confirm("Delete this application?")) return;
                    try {
                        await api(`/api/admissions/${btn.dataset.del}`, { method: "DELETE" });
                        toast("Application deleted");
                        await load();
                    } catch (err) {
                        toast(err.message, "error");
                    }
                });
            });
        };

        filter.addEventListener("change", load);
        await load();
    }

    /* ---------------------------------------------------------
       7. Contact messages
    --------------------------------------------------------- */
    async function renderMessages() {
        viewEl.innerHTML = `
            <div class="page-head">
                <div>
                    <h2>Messages</h2>
                    <p>Enquiries received from the contact form.</p>
                </div>
            </div>
            <div class="card"><div id="messagesList"><p class="empty">Loading…</p></div></div>`;

        const target = document.getElementById("messagesList");
        const rows = await api("/api/contact");

        target.innerHTML = table(
            ["From", "Subject", "Status", "Date", "Actions"],
            rows.map(
                (m) => `<tr>
                    <td><span class="cell-title">${esc(m.full_name)}</span><span class="cell-sub">${esc(m.email)}</span></td>
                    <td>${esc(m.subject)}</td>
                    <td>${badge(m.is_read ? "Read" : "Unread", m.is_read ? "muted" : "new")}</td>
                    <td>${fmtDateTime(m.created_at)}</td>
                    <td>
                        <div class="filter-row">
                            <button class="btn ghost sm" data-view="${m.id}">View</button>
                            <button class="btn danger sm" data-del="${m.id}">Delete</button>
                        </div>
                    </td>
                </tr>`
            )
        );

        target.querySelectorAll("[data-view]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const message = rows.find((r) => String(r.id) === btn.dataset.view);
                openModal(
                    message.subject,
                    `<dl class="detail-list">
                        <div><dt>From</dt><dd>${esc(message.full_name)}</dd></div>
                        <div><dt>Email</dt><dd>${esc(message.email)}</dd></div>
                        <div><dt>Phone</dt><dd>${esc(message.phone)}</dd></div>
                        <div><dt>Date</dt><dd>${fmtDateTime(message.created_at)}</dd></div>
                        <div><dt>Message</dt><dd>${esc(message.message)}</dd></div>
                    </dl>`,
                    `<button type="button" class="btn ghost" data-close>Close</button>
                     ${message.is_read ? "" : `<button type="button" class="btn primary" id="markReadBtn">Mark as read</button>`}`
                );

                const markBtn = document.getElementById("markReadBtn");
                if (markBtn) {
                    markBtn.addEventListener("click", async () => {
                        try {
                            await api(`/api/contact/${message.id}/read`, { method: "PATCH" });
                            closeModal();
                            toast("Marked as read");
                            await renderMessages();
                        } catch (err) {
                            toast(err.message, "error");
                        }
                    });
                }
            });
        });

        target.querySelectorAll("[data-del]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                if (!window.confirm("Delete this message?")) return;
                try {
                    await api(`/api/contact/${btn.dataset.del}`, { method: "DELETE" });
                    toast("Message deleted");
                    await renderMessages();
                } catch (err) {
                    toast(err.message, "error");
                }
            });
        });
    }

    /* ---------------------------------------------------------
       8. Site settings
    --------------------------------------------------------- */
    const SETTING_FIELDS = [
        { key: "school_name", label: "School Name" },
        { key: "tagline", label: "Tagline", placeholder: "Excellence in Education · Values for Life" },
        { key: "phone", label: "Phone", full: false },
        { key: "email", label: "Email" },
        { key: "address", label: "Address", type: "textarea", rows: 2, full: true },
        { key: "office_hours", label: "Office Hours", full: true },
        { key: "facebook", label: "Facebook URL", full: true },
        { key: "instagram", label: "Instagram URL", full: true },
        { key: "youtube", label: "YouTube URL", full: true },
        { key: "map_url", label: "Google Maps Embed URL", full: true },
        { key: "hero_title", label: "Homepage Hero Title", full: true },
        { key: "hero_subtitle", label: "Homepage Hero Subtitle", type: "textarea", rows: 2, full: true },
        { key: "about_text", label: "About Text", type: "textarea", rows: 4, full: true },
        { key: "admissions_note", label: "Admissions Note", type: "textarea", rows: 2, full: true },
    ];

    async function renderSettings() {
        viewEl.innerHTML = `<div class="card"><p class="empty">Loading…</p></div>`;

        const data = await api("/api/admin/settings");

        viewEl.innerHTML = `
            <div class="page-head">
                <div>
                    <h2>Site Settings</h2>
                    <p>These values appear on the public website (contact info, hero text, socials).</p>
                </div>
            </div>
            <div class="card">
                <div class="card-body">
                    <form id="settingsForm" class="form-grid" novalidate>
                        ${SETTING_FIELDS.map((f) =>
                            fieldHtml(
                                { name: f.key, label: f.label, type: f.type || "text", rows: f.rows, full: f.full, placeholder: f.placeholder },
                                data[f.key]
                            )
                        ).join("")}
                    </form>
                    <div class="form-actions">
                        <button class="btn primary" type="submit" form="settingsForm">Save Settings</button>
                        <p class="form-note">Empty fields are saved as blank.</p>
                    </div>
                </div>
            </div>`;

        document.getElementById("settingsForm").addEventListener("submit", async (event) => {
            event.preventDefault();

            const payload = SETTING_FIELDS.map((f) => {
                const input = event.target.elements[f.key];
                const value = f.type === "textarea" ? input.value : input.value.trim();
                return { key: f.key, value: value === "" ? null : value };
            });

            try {
                await api("/api/admin/settings", { method: "PUT", body: payload });
                toast("Settings saved");
            } catch (err) {
                toast(err.message, "error");
            }
        });
    }


    /* ---------------------------------------------------------
       8b. Management: Students
    --------------------------------------------------------- */
    async function renderStudents() {
        viewEl.innerHTML = `
            <div class="page-head">
                <div>
                    <h2>Students</h2>
                    <p>Manage student records, classes and login accounts.</p>
                </div>
                <button class="btn primary" id="addStudentBtn">+ Add Student</button>
            </div>
            <div class="card"><div id="studentsList"><p class="empty">Loading…</p></div></div>`;

        const isAdmin = user.role === "admin";
        const addBtn = document.getElementById("addStudentBtn");
        if (!isAdmin) addBtn.remove();

        const classes = await api("/api/classes");

        async function load() {
            const rows = await api("/api/students");
            document.getElementById("studentsList").innerHTML = table(
                ["Admission No", "Name", "Class", "Roll No", "Parent", "Phone", "Login", "Status", "Actions"],
                rows.map((s) => `<tr>
                    <td><strong>${esc(s.admission_no)}</strong></td>
                    <td>${esc(s.full_name)}</td>
                    <td>${esc(s.class_name)}</td>
                    <td>${esc(s.roll_no || "—")}</td>
                    <td>${esc(s.parent_name || "—")}</td>
                    <td>${esc(s.parent_phone || "—")}</td>
                    <td>${esc(s.login_email || "—")}</td>
                    <td>${s.is_active ? badge("Active", "ok") : badge("Inactive", "bad")}</td>
                    <td><div class="filter-row">
                        ${isAdmin ? `
                            <button class="btn ghost sm" data-edit="${s.id}">Edit</button>
                            <button class="btn ghost sm" data-reset="${s.id}">Reset Password</button>
                            <button class="btn ${s.is_active ? "danger" : "ghost"} sm" data-toggle="${s.id}">${s.is_active ? "Deactivate" : "Restore"}</button>
                        ` : "<span class='empty'>View only</span>"}
                    </div></td>
                </tr>`)
            );

            if (isAdmin) {
                document.querySelectorAll("[data-edit]").forEach((btn) =>
                    btn.addEventListener("click", () => {
                        const row = rows.find((r) => String(r.id) === btn.dataset.edit);
                        openForm(
                            {
                                title: "Edit Student",
                                fields: studentFields(classes),
                                submitLabel: "Save Changes",
                            },
                            row,
                            async (data) => {
                                await api(`/api/students/${row.id}`, { method: "PUT", body: data });
                                toast("Student updated");
                                await load();
                            }
                        );
                    })
                );

                document.querySelectorAll("[data-reset]").forEach((btn) =>
                    btn.addEventListener("click", async () => {
                        const row = rows.find((r) => String(r.id) === btn.dataset.reset);
                        const password = window.prompt(`New password for ${row.full_name} (min 6 chars):`);
                        if (!password || password.length < 6) return;
                        await api(`/api/students/${row.id}`, { method: "PUT", body: { login_password: password } });
                        toast(`Password reset → ${password}`);
                    })
                );

                document.querySelectorAll("[data-toggle]").forEach((btn) =>
                    btn.addEventListener("click", async () => {
                        const row = rows.find((r) => String(r.id) === btn.dataset.toggle);
                        if (row.is_active) {
                            await api(`/api/students/${row.id}`, { method: "DELETE" });
                            toast(`${row.full_name} deactivated`);
                        } else {
                            await api(`/api/students/${row.id}/restore`, { method: "POST" });
                            toast(`${row.full_name} restored`);
                        }
                        await load();
                    })
                );
            }
        }

        if (isAdmin) {
            addBtn.addEventListener("click", () =>
                openForm(
                    { title: "Add Student", fields: studentFields(classes), submitLabel: "Add Student" },
                    { class_name: classes[0] },
                    async (data) => {
                        const res = await api("/api/students", { method: "POST", body: data });
                        const c = res.credentials || {};
                        openModal(
                            "Student Added 🎉",
                            `<p><strong>${esc(res.student.full_name)}</strong> (${esc(res.student.class_name)}) added.</p>
                             <p>Login credentials — parent ko ye details dein:</p>
                             <div class="card" style="padding:14px;">
                                <p><strong>Email:</strong> ${esc(c.email || "—")}</p>
                                <p><strong>Password:</strong> ${esc(c.password || "—")}</p>
                             </div>`,
                            `<button class="btn primary" data-close>Done</button>`
                        );
                        await load();
                    }
                )
            );
        }

        await load();
    }

    function studentFields(classes) {
        return [
            { name: "full_name", label: "Full Name", required: true },
            { name: "class_name", label: "Class", type: "select", options: classes, required: true },
            { name: "roll_no", label: "Roll No" },
            { name: "gender", label: "Gender", type: "select", options: ["Male", "Female", "Other"] },
            { name: "dob", label: "Date of Birth", type: "date" },
            { name: "parent_name", label: "Parent Name" },
            { name: "parent_phone", label: "Parent Phone" },
            { name: "parent_email", label: "Parent Email", type: "email" },
            { name: "admission_no", label: "Admission No (auto if blank)" },
            { name: "login_email", label: "Login Email (auto if blank)", type: "email" },
            { name: "login_password", label: "Login Password (auto if blank)" },
        ];
    }

    /* ---------------------------------------------------------
       8c. Management: Attendance
    --------------------------------------------------------- */
    async function renderAttendance() {
        viewEl.innerHTML = `
            <div class="page-head">
                <div>
                    <h2>Attendance</h2>
                    <p>Mark daily class-wise attendance.</p>
                </div>
            </div>
            <div class="card" style="margin-bottom:18px;">
                <div class="filter-row">
                    <label class="field" style="margin:0;"><span>Class</span>
                        <select id="attClass"></select></label>
                    <label class="field" style="margin:0;"><span>Date</span>
                        <input type="date" id="attDay"></label>
                    <button class="btn primary" id="attLoad">Load Class</button>
                </div>
            </div>
            <div class="card"><div id="attList"><p class="empty">Class select karke Load Class dabayein.</p></div></div>`;

        const classes = await api("/api/classes");
        const classSel = document.getElementById("attClass");
        const dayInput = document.getElementById("attDay");
        const today = new Date().toISOString().slice(0, 10);
        dayInput.value = today;
        classSel.innerHTML = classes.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");

        let students = [];
        let statusMap = {};

        async function load() {
            const cls = classSel.value;
            const day = dayInput.value;
            students = (await api(`/api/students?class_name=${encodeURIComponent(cls)}`)).filter((s) => s.is_active);
            const existing = await api(`/api/attendance?class_name=${encodeURIComponent(cls)}&day=${day}`);

            statusMap = {};
            existing.forEach((a) => { statusMap[a.student_id] = a.status; });
            students.forEach((s) => { statusMap[s.student_id] = statusMap[s.student_id] || "present"; });

            if (!students.length) {
                document.getElementById("attList").innerHTML = `<p class="empty">There are no active students in this class.</p>`;
                return;
            }

            renderList();
        }

        function renderList() {
            const present = students.filter((s) => statusMap[s.student_id] === "present").length;
            document.getElementById("attList").innerHTML = `
                <div class="page-head" style="margin-bottom:14px;">
                    <p><strong>${present}</strong> present · <strong>${students.length - present}</strong> absent/leave</p>
                    <button class="btn primary" id="attSave">Save Attendance</button>
                </div>
                ${table(
                    ["Roll No", "Student", "Status"],
                    students.map((s) => `<tr>
                        <td>${esc(s.roll_no || "—")}</td>
                        <td><strong>${esc(s.full_name)}</strong></td>
                        <td>
                            <div class="filter-row" data-student="${s.id}">
                                ${["present", "absent", "leave"].map((st) =>
                                    `<button class="btn sm ${statusMap[s.student_id] === st ? "primary" : "ghost"}" data-status="${st}">${st}</button>`
                                ).join("")}
                            </div>
                        </td>
                    </tr>`)
                )}`;

            document.querySelectorAll("[data-student]").forEach((row) => {
                row.querySelectorAll("[data-status]").forEach((btn) => {
                    btn.addEventListener("click", () => {
                        statusMap[Number(row.dataset.student)] = btn.dataset.status;
                        renderList();
                    });
                });
            });

            document.getElementById("attSave").addEventListener("click", async () => {
                const day = dayInput.value;
                const records = students.map((s) => ({ student_id: s.id, status: statusMap[s.student_id] }));
                await api("/api/attendance", {
                    method: "POST",
                    body: { class_name: classSel.value, day, records },
                });
                toast("Attendance saved ✔");
            });
        }

        document.getElementById("attLoad").addEventListener("click", load);
        await load();
    }

    /* ---------------------------------------------------------
       8d. Management: Fees
    --------------------------------------------------------- */
    async function renderFees() {
        if (user.role !== "admin") {
            viewEl.innerHTML = `<div class="card"><p class="empty">Only an admin can manage fees.</p></div>`;
            return;
        }

        viewEl.innerHTML = `
            <div class="page-head">
                <div>
                    <h2>Fee Management</h2>
                    <p>Create vouchers and mark them as paid/unpaid.</p>
                </div>
                <button class="btn primary" id="addFeeBtn">+ New Voucher</button>
            </div>
            <div class="card"><div id="feesList"><p class="empty">Loading…</p></div></div>`;

        async function load() {
            const rows = await api("/api/fees");
            const pending = rows.filter((r) => r.status === "unpaid").reduce((s, r) => s + r.amount, 0);
            const collected = rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.amount, 0);

            document.getElementById("feesList").innerHTML = `
                <div class="page-head" style="margin-bottom:12px;">
                    <p>Pending: <strong>Rs ${pending.toLocaleString()}</strong> · Collected: <strong>Rs ${collected.toLocaleString()}</strong></p>
                </div>
                ${table(
                    ["Student", "Class", "Voucher", "Amount", "Due Date", "Status", "Actions"],
                    rows.map((f) => `<tr>
                        <td><strong>${esc(f.student_name)}</strong></td>
                        <td>${esc(f.class_name)}</td>
                        <td>${esc(f.title)}</td>
                        <td>Rs ${Number(f.amount).toLocaleString()}</td>
                        <td>${fmtDate(f.due_date)}</td>
                        <td>${f.status === "paid" ? badge("Paid", "ok") : badge("Unpaid", "warn")}</td>
                        <td><button class="btn sm ${f.status === "paid" ? "ghost" : "primary"}" data-pay="${f.id}" data-status="${f.status}">
                            ${f.status === "paid" ? "Mark Unpaid" : "Mark Paid"}
                        </button></td>
                    </tr>`)
                )}`;

            document.querySelectorAll("[data-pay]").forEach((btn) =>
                btn.addEventListener("click", async () => {
                    const next = btn.dataset.status === "paid" ? "unpaid" : "paid";
                    await api(`/api/fees/${btn.dataset.pay}`, { method: "PUT", body: { status: next } });
                    toast(next === "paid" ? "Marked as Paid ✔" : "Marked as Unpaid");
                    await load();
                })
            );
        }

        document.getElementById("addFeeBtn").addEventListener("click", async () => {
            const students = (await api("/api/students")).filter((s) => s.is_active);
            openForm(
                {
                    title: "New Fee Voucher",
                    fields: [
                        {
                            name: "student_id",
                            label: "Student",
                            type: "select",
                            options: students.map((s) => ({ value: s.id, label: `${s.full_name} — ${s.class_name}` })),
                            required: true,
                        },
                        { name: "title", label: "Title (e.g. Tuition Fee — Nov)", required: true },
                        { name: "amount", label: "Amount (Rs)", type: "number", required: true },
                        { name: "due_date", label: "Due Date", type: "date" },
                    ],
                    submitLabel: "Create Voucher",
                },
                { student_id: students[0] && students[0].id },
                async (data) => {
                    data.student_id = Number(data.student_id);
                    data.amount = Number(data.amount);
                    await api("/api/fees", { method: "POST", body: data });
                    toast("Voucher created");
                    await load();
                }
            );
        });

        await load();
    }

    /* ---------------------------------------------------------
       8e. Management: Results
    --------------------------------------------------------- */
    async function renderResults() {
        viewEl.innerHTML = `
            <div class="page-head">
                <div>
                    <h2>Exam Results</h2>
                    <p>Enter exam marks and view results.</p>
                </div>
                <button class="btn primary" id="addResultBtn">+ Enter Marks</button>
            </div>
            <div class="card" style="margin-bottom:18px;">
                <div class="filter-row">
                    <label class="field" style="margin:0;"><span>Exam</span>
                        <input type="text" id="resExam" placeholder="Mid-Term 2026"></label>
                    <label class="field" style="margin:0;"><span>Class</span>
                        <select id="resClass"></select></label>
                    <button class="btn ghost" id="resFilter">Filter</button>
                </div>
            </div>
            <div class="card"><div id="resultsList"><p class="empty">Loading…</p></div></div>`;

        const isAdmin = user.role === "admin";
        const classes = await api("/api/classes");
        const classSel = document.getElementById("resClass");
        classSel.innerHTML = `<option value="">All classes</option>` + classes.map((c) => `<option>${esc(c)}</option>`).join("");

        async function load() {
            const exam = document.getElementById("resExam").value.trim();
            const cls = classSel.value;
            const query = new URLSearchParams();
            if (exam) query.set("exam_name", exam);
            if (cls) query.set("class_name", cls);

            const rows = await api(`/api/results?${query.toString()}`);
            document.getElementById("resultsList").innerHTML = table(
                ["Exam", "Student", "Class", "Subject", "Marks", "%"],
                rows.map((r) => {
                    const pct = r.total_marks ? Math.round((r.marks_obtained / r.total_marks) * 100) : 0;
                    return `<tr>
                        <td>${esc(r.exam_name)}</td>
                        <td><strong>${esc(r.student_name)}</strong></td>
                        <td>${esc(r.class_name)}</td>
                        <td>${esc(r.subject)}</td>
                        <td>${r.marks_obtained} / ${r.total_marks}</td>
                        <td>${pct >= 60 ? badge(pct + "%", "ok") : pct >= 40 ? badge(pct + "%", "warn") : badge(pct + "%", "bad")}</td>
                    </tr>`;
                })
            );
        }

        if (!isAdmin) document.getElementById("addResultBtn").remove();

        if (isAdmin) {
            document.getElementById("addResultBtn").addEventListener("click", async () => {
                openForm(
                    {
                        title: "Enter Marks (whole class)",
                        fields: [
                            { name: "exam_name", label: "Exam Name", required: true },
                            { name: "class_name", label: "Class", type: "select", options: classes, required: true },
                            { name: "subject", label: "Subject", required: true },
                            { name: "total_marks", label: "Total Marks", type: "number", default: 100, required: true },
                        ],
                        submitLabel: "Continue →",
                    },
                    { exam_name: "Mid-Term 2026", class_name: classes[0], subject: "", total_marks: 100 },
                    async (data) => {
                        const students = (await api(`/api/students?class_name=${encodeURIComponent(data.class_name)}`)).filter((s) => s.is_active);
                        if (!students.length) { toast("There are no students in this class", "error"); return; }

                        const bodyHtml = `
                            <p>${esc(data.exam_name)} · ${esc(data.class_name)} · ${esc(data.subject)} (/${esc(data.total_marks)})</p>
                            ${table(
                                ["Student", "Marks Obtained"],
                                students.map((s) => `<tr>
                                    <td><strong>${esc(s.full_name)}</strong> (${esc(s.roll_no || "—")})</td>
                                    <td><input type="number" min="0" max="${esc(data.total_marks)}" step="0.5" data-marks="${s.id}" style="width:110px;"></td>
                                </tr>`)
                            )}`;

                        openModal("Enter Marks", bodyHtml, `<button class="btn primary" id="saveMarks">Save All</button>`);

                        document.getElementById("saveMarks").addEventListener("click", async () => {
                            const marks = [];
                            document.querySelectorAll("[data-marks]").forEach((inp) => {
                                if (inp.value === "") return;
                                marks.push({ student_id: Number(inp.dataset.marks), marks_obtained: Number(inp.value) });
                            });
                            if (!marks.length) { toast("Kam se kam ek marks likhein", "error"); return; }
                            const res = await api("/api/results/bulk", {
                                method: "POST",
                                body: {
                                    exam_name: data.exam_name,
                                    subject: data.subject,
                                    total_marks: Number(data.total_marks),
                                    marks,
                                },
                            });
                            closeModal();
                            toast(`${res.saved} students ke marks save hue ✔`);
                            await load();
                        });
                    }
                );
            });
        }

        document.getElementById("resFilter").addEventListener("click", load);
        await load();
    }

    /* ---------------------------------------------------------
       9. View switching
    --------------------------------------------------------- */
    const VIEWS = {
        dashboard: renderDashboard,
        admissions: renderAdmissions,
        messages: renderMessages,
        news: () => renderResource("news"),
        notices: () => renderResource("notices"),
        events: () => renderResource("events"),
        gallery: () => renderResource("gallery"),
        faculty: () => renderResource("faculty"),
        students: renderStudents,
        attendance: renderAttendance,
        fees: renderFees,
        results: renderResults,
        settings: renderSettings,
    };

    const VIEW_TITLES = {
        dashboard: "Dashboard",
        admissions: "Admissions",
        messages: "Messages",
        news: "News",
        notices: "Notices",
        events: "Events",
        gallery: "Gallery",
        faculty: "Faculty",
        students: "Students",
        attendance: "Attendance",
        fees: "Fees",
        results: "Exam Results",
        settings: "Site Settings",
    };

    let current = "dashboard";

    function setActiveNav(name) {
        document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.view === name);
        });
    }

    async function show(name) {
        if (!VIEWS[name]) name = "dashboard";
        current = name;
        pageTitle.textContent = VIEW_TITLES[name];
        setActiveNav(name);
        window.history.replaceState(null, "", `#${name}`);
        closeSidebar();

        try {
            await VIEWS[name]();
        } catch (err) {
            if (err.message !== "Session expired") {
                viewEl.innerHTML = `<div class="card"><p class="empty">${esc(err.message)}</p></div>`;
            }
        }
    }

    /* ---------------------------------------------------------
       10. Shell wiring
    --------------------------------------------------------- */
    function closeSidebar() {
        document.getElementById("sidebar").classList.remove("open");
    }

    document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
        btn.addEventListener("click", () => show(btn.dataset.view));
    });

    document.getElementById("logoutBtn").addEventListener("click", () => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        window.location.replace("index.html");
    });

    document.getElementById("menuBtn").addEventListener("click", () => {
        document.getElementById("sidebar").classList.toggle("open");
    });

    document.getElementById("avatar").textContent = initials(user.full_name);
    document.getElementById("userName").textContent = user.full_name;
    document.querySelector(".sidebar-brand small").textContent =
        user.role === "teacher" ? "Teacher Panel" : "Admin Panel";

    if (user.role === "teacher") {
        const allowed = ["dashboard", "students", "attendance", "results"];
        document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
            if (!allowed.includes(btn.dataset.view)) btn.hidden = true;
        });
    }

    show(window.location.hash.replace("#", "") || "dashboard");
})();
