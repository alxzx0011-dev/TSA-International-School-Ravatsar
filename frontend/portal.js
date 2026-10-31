/* =========================================================
   Student Portal — login, attendance, fees, results, notices
========================================================= */
(function () {
    "use strict";

    const API = window.SCHOOL_API || "";
    const TOKEN_KEY = "tsa_portal_token";
    const USER_KEY = "tsa_portal_user";

    const $ = (id) => document.getElementById(id);

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        }[ch]));
    }

    function fmtMoney(n) {
        return "Rs " + Number(n || 0).toLocaleString();
    }

    function fmtDate(value) {
        if (!value) return "—";
        const d = new Date(value);
        return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    }

    function statusPill(status) {
        const map = { present: "ok", paid: "ok", absent: "bad", unpaid: "warn", leave: "warn" };
        return `<span class="pill ${map[status] || ""}">${esc(status)}</span>`;
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
            if (!res.ok) throw new Error(data.detail || "Request failed");
            return data;
        } catch (err) {
            console.error(path, err);
            return null;
        }
    }

    function setMessage(text, kind) {
        const el = $("loginMessage");
        el.textContent = text || "";
        el.className = "form-status" + (kind ? " " + kind : "");
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

        if (data.user && data.user.role !== "student") {
            setMessage("This is the student portal. Staff should use the admin panel.", "error");
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

        const data = await getJSON("/api/portal/me");
        if (!data) {
            if (localStorage.getItem(TOKEN_KEY)) setMessage("Session expired — please log in again.", "error");
            return;
        }

        $("loginView").hidden = true;
        $("dashView").hidden = false;
        $("logoutBtn").hidden = false;

        const p = data.profile;
        $("welcomeName").textContent = p.full_name;
        $("profileLine").textContent =
            `${p.class_name} · Admission No: ${p.admission_no}` +
            (p.roll_no ? ` · Roll No: ${p.roll_no}` : "") +
            (p.parent_name ? ` · Parent: ${p.parent_name}` : "") +
            (p.parent_phone ? ` · ${p.parent_phone}` : "");

        const unpaid = data.fees.filter((f) => f.status === "unpaid");
        const pending = unpaid.reduce((sum, f) => sum + Number(f.amount || 0), 0);

        $("portalStats").innerHTML = `
            <div class="portal-stat">
                <h3>${esc(data.attendance.percent)}%</h3>
                <p>Attendance</p>
            </div>
            <div class="portal-stat">
                <h3>${esc(data.attendance.present)} / ${esc(data.attendance.total)}</h3>
                <p>Days Present</p>
            </div>
            <div class="portal-stat">
                <h3 class="${unpaid.length ? "danger" : ""}">${esc(unpaid.length)}</h3>
                <p>Unpaid Vouchers</p>
            </div>
            <div class="portal-stat">
                <h3 class="${pending ? "danger" : ""}">${fmtMoney(pending)}</h3>
                <p>Pending Amount</p>
            </div>`;

        const a = data.attendance;
        $("attendanceSummary").innerHTML = `
            <div class="att-bar"><span style="width:${a.percent}%"></span></div>
            <p class="muted">
                ${a.present} present · ${a.absent} absent · ${a.leave} leave
            </p>`;

        $("attendanceList").innerHTML = a.recent.length
            ? `<table class="portal-table">
                    <thead><tr><th>Date</th><th>Status</th></tr></thead>
                    <tbody>
                        ${a.recent.map((r) => `
                            <tr>
                                <td>${fmtDate(r.day)}</td>
                                <td>${statusPill(r.status)}</td>
                            </tr>`).join("")}
                    </tbody>
                </table>`
            : `<p class="empty-note">No attendance has been marked yet.</p>`;

        $("feesList").innerHTML = data.fees.length
            ? `<table class="portal-table">
                    <thead><tr><th>Voucher</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead>
                    <tbody>
                        ${data.fees.map((f) => `
                            <tr>
                                <td>${esc(f.title)}</td>
                                <td>${fmtMoney(f.amount)}</td>
                                <td>${fmtDate(f.due_date)}</td>
                                <td>${statusPill(f.status)}${f.paid_at ? ` <small class="muted">${fmtDate(f.paid_at)}</small>` : ""}</td>
                            </tr>`).join("")}
                    </tbody>
                </table>`
            : `<p class="empty-note">No fee vouchers are available.</p>`;

        // results grouped by exam
        const exams = {};
        data.results.forEach((r) => {
            (exams[r.exam_name] = exams[r.exam_name] || []).push(r);
        });

        const examBlocks = Object.keys(exams).map((exam) => {
            const rows = exams[exam];
            const totalObt = rows.reduce((s, r) => s + r.marks_obtained, 0);
            const totalMax = rows.reduce((s, r) => s + r.total_marks, 0);
            const pct = totalMax ? Math.round((totalObt / totalMax) * 100) : 0;
            return `
                <h3 class="exam-title">${esc(exam)} <span class="pill ${pct >= 60 ? "ok" : pct >= 40 ? "warn" : "bad"}">${pct}%</span></h3>
                <table class="portal-table">
                    <thead><tr><th>Subject</th><th>Marks</th><th>%</th><th>Grade</th></tr></thead>
                    <tbody>
                        ${rows.map((r) => {
                            const g = r.percent >= 80 ? "A+" : r.percent >= 70 ? "A" : r.percent >= 60 ? "B" : r.percent >= 50 ? "C" : r.percent >= 40 ? "D" : "F";
                            return `<tr>
                                <td>${esc(r.subject)}</td>
                                <td>${r.marks_obtained} / ${r.total_marks}</td>
                                <td>${r.percent}%</td>
                                <td><span class="pill ${g === "F" ? "bad" : g === "D" ? "warn" : "ok"}">${g}</span></td>
                            </tr>`;
                        }).join("")}
                    </tbody>
                </table>`;
        }).join("");

        $("resultsList").innerHTML = examBlocks || `<p class="empty-note">Results have not been announced yet.</p>`;

        $("noticesList").innerHTML = data.notices.length
            ? data.notices.map((n) => `
                    <div class="notice-row">
                        <div>
                            <h4>${esc(n.title)}</h4>
                            <p>${esc(n.message)}</p>
                        </div>
                        <span class="muted">${fmtDate(n.created_at)}</span>
                    </div>`).join("")
            : `<p class="empty-note">There are no notices.</p>`;
    }

    /* ---------------- start ---------------- */
    $("year").textContent = new Date().getFullYear();
    $("loginForm").addEventListener("submit", login);
    $("logoutBtn").addEventListener("click", () => logout(true));
    $("refreshBtn").addEventListener("click", loadDashboard);

    if (localStorage.getItem(TOKEN_KEY)) loadDashboard();
})();
