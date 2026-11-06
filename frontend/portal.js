/* =========================================================
   Student Portal — login, attendance, fees, results, notices
========================================================= */
(function () {
    "use strict";

    const API = window.SCHOOL_API || "";
    const TOKEN_KEY = "tsa_portal_token";
    const USER_KEY = "tsa_portal_user";
    const REQUEST_TIMEOUT = 30000;

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

    function gradeFor(percent) {
        if (percent >= 80) return "A+";
        if (percent >= 70) return "A";
        if (percent >= 60) return "B";
        if (percent >= 50) return "C";
        if (percent >= 40) return "D";
        return "F";
    }

    async function getJSON(path, options = {}) {
        const token = localStorage.getItem(TOKEN_KEY);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
        try {
            const res = await fetch(API + path, {
                ...options,
                signal: controller.signal,
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
        } finally {
            clearTimeout(timer);
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
            setMessage("Login failed or the server timed out. Check your email, password and internet connection.", "error");
            $("loginBtn").disabled = false;
            return;
        }

        if (data.user && data.user.role !== "student") {
            setMessage("This is the student portal. Parents should use the parent portal and staff should use the school login.", "error");
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
                <h3 class="exam-title">
                    ${esc(exam)}
                    <span class="pill ${pct >= 60 ? "ok" : pct >= 40 ? "warn" : "bad"}">${pct}%</span>
                    <button class="secondary-button" data-pdf-exam="${esc(exam)}">Download PDF</button>
                </h3>
                <table class="portal-table">
                    <thead><tr><th>Subject</th><th>Marks</th><th>%</th><th>Grade</th></tr></thead>
                    <tbody>
                        ${rows.map((r) => {
                            const g = gradeFor(r.percent);
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

        document.querySelectorAll("[data-pdf-exam]").forEach((btn) => {
            btn.addEventListener("click", () => {
                printResult(data.profile, btn.dataset.pdfExam, exams[btn.dataset.pdfExam]);
            });
        });

        $("notesList").innerHTML = (data.notes || []).length
            ? data.notes.map((n) => `
                    <div class="notice-row">
                        <div>
                            <h4>${esc(n.title)} <span class="pill">${esc(n.category)}</span></h4>
                            <p>${esc(n.message)}</p>
                            <p class="muted">By ${esc(n.teacher_name)} · ${fmtDate(n.created_at)}</p>
                        </div>
                    </div>`).join("")
            : `<p class="empty-note">No teacher notes yet.</p>`;

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

    /* ---------------- result PDF ---------------- */
    function printResult(profile, examName, rows) {
        if (!rows || !rows.length) return;

        const totalObt = rows.reduce((s, r) => s + r.marks_obtained, 0);
        const totalMax = rows.reduce((s, r) => s + r.total_marks, 0);
        const pct = totalMax ? Math.round((totalObt / totalMax) * 100) : 0;
        const grade = gradeFor(pct);
        const logo = new URL("assets/tsa-logo-256.jpg", window.location.href).href;

        const win = window.open("", "_blank");
        if (!win) {
            window.alert("Please allow pop-ups to download the result PDF.");
            return;
        }

        win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(profile.full_name)} — ${esc(examName)} Result</title>
<style>
    body { font-family: Arial, Helvetica, sans-serif; color: #21362e; margin: 40px; }
    .head { display: flex; align-items: center; gap: 16px; border-bottom: 3px solid #0b3d2e; padding-bottom: 16px; }
    .head img { width: 72px; height: 72px; object-fit: cover; border-radius: 12px; }
    .head h1 { margin: 0; font-size: 22px; color: #0b3d2e; }
    .head p { margin: 4px 0 0; color: #6b8177; font-size: 13px; }
    h2 { text-align: center; margin: 28px 0 18px; letter-spacing: 1px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 20px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #cfe0d8; padding: 9px 10px; text-align: left; font-size: 14px; }
    th { background: #e3f2eb; color: #0b3d2e; }
    .total { margin-top: 18px; font-size: 15px; }
    .total strong { color: #0b3d2e; }
    .sign { margin-top: 60px; display: flex; justify-content: space-between; font-size: 13px; color: #6b8177; }
    .sign span { border-top: 1px solid #6b8177; padding-top: 6px; width: 180px; text-align: center; }
    @media print { body { margin: 18mm; } }
</style>
</head>
<body>
    <div class="head">
        <img src="${logo}" alt="School logo">
        <div>
            <h1>TSA International School, Rawatsar</h1>
            <p>Court Road, near Panchayat Samiti, Rawatsar, Hanumangarh, Rajasthan 335524</p>
        </div>
    </div>

    <h2>REPORT CARD</h2>

    <div class="meta">
        <div><strong>Student:</strong> ${esc(profile.full_name)}</div>
        <div><strong>Class:</strong> ${esc(profile.class_name)}</div>
        <div><strong>Admission No:</strong> ${esc(profile.admission_no)}</div>
        <div><strong>Roll No:</strong> ${esc(profile.roll_no || "—")}</div>
        <div><strong>Examination:</strong> ${esc(examName)}</div>
        <div><strong>Date:</strong> ${new Date().toLocaleDateString("en-GB")}</div>
    </div>

    <table>
        <thead><tr><th>Subject</th><th>Marks Obtained</th><th>Total Marks</th><th>Percentage</th><th>Grade</th></tr></thead>
        <tbody>
            ${rows.map((r) => `
                <tr>
                    <td>${esc(r.subject)}</td>
                    <td>${r.marks_obtained}</td>
                    <td>${r.total_marks}</td>
                    <td>${r.percent}%</td>
                    <td>${gradeFor(r.percent)}</td>
                </tr>`).join("")}
        </tbody>
    </table>

    <p class="total">
        <strong>Total:</strong> ${totalObt} / ${totalMax} &nbsp; · &nbsp;
        <strong>Percentage:</strong> ${pct}% &nbsp; · &nbsp;
        <strong>Grade:</strong> ${grade}
    </p>

    <div class="sign">
        <span>Class Teacher</span>
        <span>Principal</span>
        <span>Parent / Guardian</span>
    </div>
</body>
</html>`);
        win.document.close();
        win.focus();
        setTimeout(() => win.print(), 400);
    }

    /* ---------------- start ---------------- */
    $("year").textContent = new Date().getFullYear();
    $("loginForm").addEventListener("submit", login);
    $("logoutBtn").addEventListener("click", () => logout(true));
    $("refreshBtn").addEventListener("click", loadDashboard);

    if (localStorage.getItem(TOKEN_KEY)) loadDashboard();
})();
