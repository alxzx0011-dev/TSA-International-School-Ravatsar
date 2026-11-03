/* =========================================================
   Admissions Portal — review admission applications
========================================================= */
(function () {
    "use strict";

    const API = window.SCHOOL_API || "";
    const TOKEN_KEY = "tsa_admissions_token";
    const USER_KEY = "tsa_admissions_user";
    const ALLOWED_ROLES = ["admissions", "admin", "owner"];
    const STATUSES = ["new", "reviewing", "approved", "rejected"];

    const $ = (id) => document.getElementById(id);
    let applications = [];

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        }[ch]));
    }

    function fmtDate(value) {
        if (!value) return "—";
        const d = new Date(value);
        return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    }

    function statusPill(status) {
        const map = { new: "bad", reviewing: "warn", approved: "ok", rejected: "bad" };
        return `<span class="pill ${map[status] || ""}">${esc(status)}</span>`;
    }

    function setMessage(text, kind) {
        const el = $("loginMessage");
        el.textContent = text || "";
        el.className = "form-status" + (kind ? " " + kind : "");
    }

    async function getJSON(path, options = {}) {
        const token = localStorage.getItem(TOKEN_KEY);
        try {
            const res = await fetch(API + path, {
                ...options,
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    ...(token ? { Authorization: "Bearer " + token } : {}),
                    ...(options.headers || {}),
                },
            });

            if (res.status === 401) {
                logout(false);
                return null;
            }

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const detail = data.detail;
                throw new Error(typeof detail === "string" ? detail : "Request failed");
            }
            return data;
        } catch (err) {
            console.error(path, err);
            return null;
        }
    }

    /* ---------------- login / logout ---------------- */
    async function login(event) {
        event.preventDefault();
        const email = $("email").value.trim();
        const password = $("password").value;

        if (!email || !password) {
            setMessage("Both email and password are required.", "error");
            return;
        }

        $("loginBtn").disabled = true;
        setMessage("Signing in…");

        const data = await getJSON("/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
        });

        if (!data) {
            setMessage("Login failed — incorrect email or password.", "error");
            $("loginBtn").disabled = false;
            return;
        }

        if (!data.user || !ALLOWED_ROLES.includes(data.user.role)) {
            setMessage("This portal is for the admissions team.", "error");
            $("loginBtn").disabled = false;
            return;
        }

        localStorage.setItem(TOKEN_KEY, data.access_token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        $("loginBtn").disabled = false;
        await loadDashboard();
    }

    function logout(showMessage) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        $("dashView").hidden = true;
        $("loginView").hidden = false;
        $("logoutBtn").hidden = true;
        if (showMessage !== false) setMessage("You have been logged out.");
    }

    /* ---------------- dashboard ---------------- */
    async function loadDashboard() {
        if (!localStorage.getItem(TOKEN_KEY)) return;

        let user = null;
        try {
            user = JSON.parse(localStorage.getItem(USER_KEY) || "null");
        } catch (err) {
            user = null;
        }

        if (!user || !ALLOWED_ROLES.includes(user.role)) {
            logout(false);
            return;
        }

        $("loginView").hidden = true;
        $("dashView").hidden = false;
        $("logoutBtn").hidden = false;
        $("welcomeName").textContent = user.full_name;
        $("profileLine").textContent = `${user.email} · ${user.role === "admissions" ? "Admissions Officer" : user.role === "owner" ? "School Owner" : "Administrator"}`;

        await loadApplications();
    }

    async function loadApplications() {
        const rows = await getJSON("/api/admissions");
        applications = Array.isArray(rows) ? rows : [];
        renderStats();
        renderApplications();
    }

    function renderStats() {
        const counts = { new: 0, reviewing: 0, approved: 0, rejected: 0 };
        applications.forEach((a) => {
            if (counts[a.status] !== undefined) counts[a.status] += 1;
        });

        $("admissionStats").innerHTML = `
            <div class="portal-stat"><h3>${applications.length}</h3><p>Total Applications</p></div>
            <div class="portal-stat"><h3 class="${counts.new ? "danger" : ""}">${counts.new}</h3><p>New</p></div>
            <div class="portal-stat"><h3>${counts.reviewing}</h3><p>Under Review</p></div>
            <div class="portal-stat"><h3>${counts.approved}</h3><p>Approved</p></div>
            <div class="portal-stat"><h3>${counts.rejected}</h3><p>Rejected</p></div>`;
    }

    function visibleApplications() {
        const term = $("appSearch").value.trim().toLowerCase();
        const status = $("appStatus").value;

        return applications.filter((a) => {
            if (status && a.status !== status) return false;
            if (!term) return true;
            return [a.student_name, a.parent_name, a.parent_email, a.phone, a.class_name]
                .join(" ")
                .toLowerCase()
                .includes(term);
        });
    }

    function renderApplications() {
        const rows = visibleApplications();

        if (!rows.length) {
            $("applicationsList").innerHTML = `<p class="portal-empty">No applications match your filter.</p>`;
            return;
        }

        $("applicationsList").innerHTML = rows.map((a) => `
            <div class="portal-list-item">
                <h4>
                    ${esc(a.student_name)}
                    ${statusPill(a.status)}
                </h4>
                <p>
                    Applying for <strong>${esc(a.class_name)}</strong>
                    · Parent: ${esc(a.parent_name)}
                    · Received ${fmtDate(a.created_at)}
                </p>
                <p class="muted">
                    ${esc(a.parent_email)} · ${esc(a.phone)}
                </p>
                ${a.message ? `<div class="portal-note"><strong>Message from parent</strong>${esc(a.message)}</div>` : ""}
                <div class="portal-actions">
                    <label for="status-${a.id}" style="margin:0; align-self:center;">Update status</label>
                    <select id="status-${a.id}" data-status="${a.id}" style="max-width:180px;">
                        ${STATUSES.map((s) => `<option value="${s}" ${a.status === s ? "selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}
                    </select>
                </div>
            </div>`).join("");

        document.querySelectorAll("select[data-status]").forEach((select) => {
            select.addEventListener("change", async () => {
                const result = await getJSON(`/api/admissions/${select.dataset.status}`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: select.value }),
                });

                if (!result) {
                    window.alert("Status could not be updated. Please try again.");
                    return;
                }

                const item = applications.find((a) => String(a.id) === select.dataset.status);
                if (item) item.status = select.value;
                renderStats();
                renderApplications();
            });
        });
    }

    /* ---------------- start ---------------- */
    $("year").textContent = new Date().getFullYear();
    $("loginForm").addEventListener("submit", login);
    $("logoutBtn").addEventListener("click", () => logout(true));
    $("refreshBtn").addEventListener("click", loadApplications);
    $("appFilterBtn").addEventListener("click", renderApplications);
    $("appSearch").addEventListener("input", renderApplications);
    $("appStatus").addEventListener("change", renderApplications);

    if (localStorage.getItem(TOKEN_KEY)) loadDashboard();
})();
