/* =========================================================
   Parent Portal — children, attendance, fees, results,
   teacher notes and complaints
========================================================= */
(function () {
    "use strict";

    const API = window.SCHOOL_API || "";
    const TOKEN_KEY = "tsa_parent_token";
    const USER_KEY = "tsa_parent_user";
    const REQUEST_TIMEOUT = 30000;

    const $ = (id) => document.getElementById(id);
    let currentData = null;

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
        const map = { present: "ok", paid: "ok", absent: "bad", unpaid: "warn", leave: "warn", answered: "ok", closed: "warn", open: "bad", pending: "warn", approved: "ok", rejected: "bad", submitted: "warn", checked: "ok" };
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

    function setComplaintMessage(text, kind) {
        const el = $("complaintStatus");
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

        if (data.user && data.user.role !== "parent") {
            setMessage("This portal is for parents. Students should use the student portal and staff should use the admin panel.", "error");
            $("loginBtn").disabled = false;
            return;
        }

        localStorage.setItem(TOKEN_KEY, data.access_token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        $("loginBtn").disabled = false;
        setMessage("");
        await loadDashboard();
    }

    function logout(showMessage) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        $("dashView").hidden = true;
        $("loginView").hidden = false;
        $("logoutBtn").hidden = true;
        $("changePasswordBtn").hidden = true;
        if (showMessage !== false) setMessage("You have been logged out.");
    }

    /* ---------------- dashboard ---------------- */
    async function loadDashboard() {
        if (!localStorage.getItem(TOKEN_KEY)) return;

        const data = await getJSON("/api/parent/me");
        if (!data) {
            if (localStorage.getItem(TOKEN_KEY)) setMessage("Session expired — please log in again.", "error");
            return;
        }

        currentData = data;
        $("loginView").hidden = true;
        $("dashView").hidden = false;
        $("logoutBtn").hidden = false;
        $("changePasswordBtn").hidden = false;

        $("welcomeName").textContent = data.parent.full_name;
        $("profileLine").textContent = `${data.parent.email} · ${data.children.length} child${data.children.length === 1 ? "" : "ren"} linked`;

        renderStats(data);
        renderChildren(data);
        renderComplaints(data);
        renderNotices(data);
        fillComplaintSelect(data);
        fillLeaveSelect(data);
        loadTimetable();
        loadLeave();
    }

    function renderStats(data) {
        let pending = 0;
        let notes = 0;

        data.children.forEach((child) => {
            child.fees.forEach((fee) => {
                if (fee.status === "unpaid") pending += Number(fee.amount || 0);
            });
            notes += child.notes.length;
        });

        const open = data.complaints.filter((c) => c.status === "open").length;

        $("parentStats").innerHTML = `
            <div class="portal-stat">
                <h3>${esc(data.children.length)}</h3>
                <p>Children</p>
            </div>
            <div class="portal-stat">
                <h3 class="${pending ? "danger" : ""}">${fmtMoney(pending)}</h3>
                <p>Pending Fees</p>
            </div>
            <div class="portal-stat">
                <h3>${esc(notes)}</h3>
                <p>Teacher Notes</p>
            </div>
            <div class="portal-stat">
                <h3 class="${open ? "danger" : ""}">${esc(open)}</h3>
                <p>Open Complaints</p>
            </div>`;
    }

    function renderChildren(data) {
        if (!data.children.length) {
            $("childrenWrap").innerHTML = `
                <article class="portal-card">
                    <h2>No Child Linked Yet</h2>
                    <p class="empty-note">
                        Your account is not linked to a student profile yet.
                        Please contact the school office with your child's admission number.
                    </p>
                </article>`;
            return;
        }

        $("childrenWrap").innerHTML = data.children.map((child, index) => childCard(child, index)).join("");

        document.querySelectorAll("[data-pdf-child]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const child = data.children[Number(btn.dataset.pdfChild)];
                printResult(child, btn.dataset.pdfExam);
            });
        });
    }

    function childCard(child, index) {
        const p = child.profile;
        const unpaid = child.fees.filter((f) => f.status === "unpaid");
        const pending = unpaid.reduce((sum, f) => sum + Number(f.amount || 0), 0);

        const exams = {};
        child.results.forEach((r) => {
            (exams[r.exam_name] = exams[r.exam_name] || []).push(r);
        });

        const examBlocks = Object.keys(exams).map((exam) => {
            const rows = exams[exam];
            const totalObt = rows.reduce((s, r) => s + r.marks_obtained, 0);
            const totalMax = rows.reduce((s, r) => s + r.total_marks, 0);
            const pct = totalMax ? Math.round((totalObt / totalMax) * 100) : 0;
            const grade = gradeFor(pct);

            return `
                <div class="exam-block">
                    <h3 class="exam-title">
                        ${esc(exam)}
                        <span class="pill ${pct >= 60 ? "ok" : pct >= 40 ? "warn" : "bad"}">${pct}% · ${grade}</span>
                        <button class="secondary-button" data-pdf-child="${index}" data-pdf-exam="${esc(exam)}">Download PDF</button>
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
                    </table>
                </div>`;
        }).join("");

        return `
            <article class="portal-card">
                <div class="portal-hero" style="margin-bottom:18px;">
                    <div>
                        <span class="eyebrow">CHILD PROFILE</span>
                        <h2 style="margin:4px 0 2px;">${esc(p.full_name)}</h2>
                        <p class="muted">
                            ${esc(p.class_name)}
                            ${p.roll_no ? ` · Roll No ${esc(p.roll_no)}` : ""}
                            · Admission No ${esc(p.admission_no)}
                            ${p.parent_name ? ` · Parent ${esc(p.parent_name)}` : ""}
                        </p>
                    </div>
                    <span class="pill ${p.is_active ? "ok" : "bad"}">${p.is_active ? "Active" : "Inactive"}</span>
                </div>

                <div class="portal-stats">
                    <div class="portal-stat">
                        <h3>${esc(child.attendance.percent)}%</h3>
                        <p>Attendance</p>
                    </div>
                    <div class="portal-stat">
                        <h3>${esc(child.attendance.present)} / ${esc(child.attendance.total)}</h3>
                        <p>Days Present</p>
                    </div>
                    <div class="portal-stat">
                        <h3 class="${unpaid.length ? "danger" : ""}">${esc(unpaid.length)}</h3>
                        <p>Unpaid Vouchers</p>
                    </div>
                    <div class="portal-stat">
                        <h3 class="${pending ? "danger" : ""}">${fmtMoney(pending)}</h3>
                        <p>Pending Amount</p>
                    </div>
                </div>

                <div class="portal-grid">
                    <div>
                        <h3>Attendance</h3>
                        <div class="att-bar"><span style="width:${child.attendance.percent}%"></span></div>
                        <p class="muted">
                            ${child.attendance.present} present · ${child.attendance.absent} absent · ${child.attendance.leave} leave
                        </p>
                        ${child.attendance.recent.length ? `
                            <table class="portal-table">
                                <thead><tr><th>Date</th><th>Status</th></tr></thead>
                                <tbody>
                                    ${child.attendance.recent.map((r) => `
                                        <tr><td>${fmtDate(r.day)}</td><td>${statusPill(r.status)}</td></tr>`).join("")}
                                </tbody>
                            </table>` : `<p class="empty-note">No attendance marked yet.</p>`}
                    </div>

                    <div>
                        <h3>Fee Status</h3>
                        ${child.fees.length ? `
                            <table class="portal-table">
                                <thead><tr><th>Voucher</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead>
                                <tbody>
                                    ${child.fees.map((f) => `
                                        <tr>
                                            <td>${esc(f.title)}</td>
                                            <td>${fmtMoney(f.amount)}</td>
                                            <td>${fmtDate(f.due_date)}</td>
                                            <td>${statusPill(f.status)}</td>
                                        </tr>`).join("")}
                                </tbody>
                            </table>` : `<p class="empty-note">No fee vouchers available.</p>`}
                    </div>
                </div>

                <h3 style="margin-top:24px;">Exam Results</h3>
                ${examBlocks || `<p class="empty-note">Results have not been announced yet.</p>`}

                <h3 style="margin-top:24px;">Teacher Notes &amp; Homework</h3>
                ${child.notes.length ? child.notes.map((n) => `
                    <div class="notice-row">
                        <div>
                            <h4>${esc(n.title)} <span class="pill">${esc(n.category)}</span></h4>
                            <p>${esc(n.message)}</p>
                            <p class="muted">By ${esc(n.teacher_name)} · ${fmtDate(n.created_at)}</p>
                        </div>
                    </div>`).join("") : `<p class="empty-note">No teacher notes yet.</p>`}
            </article>`;
    }

    /* ---------------- timetable ---------------- */
    async function loadTimetable() {
        const data = await getJSON("/api/timetable/mine");
        const groups = Array.isArray(data) ? data : [];

        if (!groups.length) {
            $("timetableWrap").innerHTML = `<p class="empty-note">No timetable has been published yet.</p>`;
            return;
        }

        const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

        $("timetableWrap").innerHTML = groups.map((group) => {
            if (!group.slots.length) {
                return `<h3>${esc(group.student_name)} — ${esc(group.class_name)}</h3>
                        <p class="empty-note">No timetable has been set for this class yet.</p>`;
            }

            const byKey = {};
            group.slots.forEach((s) => { byKey[`${s.day_of_week}-${s.period}`] = s; });
            const maxPeriod = Math.max(8, ...group.slots.map((s) => Number(s.period || 0)));

            let html = `<h3>${esc(group.student_name)} — ${esc(group.class_name)}</h3>`;
            html += `<table class="portal-table"><thead><tr><th>Period</th>${days.map((d) => `<th>${d}</th>`).join("")}</tr></thead><tbody>`;
            for (let p = 1; p <= maxPeriod; p += 1) {
                html += `<tr><td><strong>P${p}</strong></td>`;
                days.forEach((day) => {
                    const slot = byKey[`${day}-${p}`];
                    html += `<td>${slot ? `<strong>${esc(slot.subject)}</strong>${slot.teacher_name ? `<br><small class="muted">${esc(slot.teacher_name)}</small>` : ""}${slot.room ? `<br><small class="muted">Room ${esc(slot.room)}</small>` : ""}` : "—"}</td>`;
                });
                html += "</tr>";
            }
            html += "</tbody></table>";
            return html;
        }).join("");
    }

    /* ---------------- leave applications ---------------- */
    function fillLeaveSelect(data) {
        $("leaveChild").innerHTML = data.children
            .map((child) => `<option value="${child.profile.id}">${esc(child.profile.full_name)} — ${esc(child.profile.class_name)}</option>`)
            .join("");
    }

    function setLeaveMessage(text, kind) {
        const el = $("leaveStatusMsg");
        el.textContent = text || "";
        el.className = "form-status" + (kind ? " " + kind : "");
    }

    async function submitLeave(event) {
        event.preventDefault();

        const studentId = Number($("leaveChild").value);
        const fromDate = $("leaveFrom").value;
        const toDate = $("leaveTo").value;
        const reason = $("leaveReason").value.trim();

        if (!studentId || !fromDate || !toDate || !reason) {
            setLeaveMessage("Please choose your child, both dates and a reason.", "error");
            return;
        }

        if (toDate < fromDate) {
            setLeaveMessage("The 'To' date cannot be before the 'From' date.", "error");
            return;
        }

        $("leaveBtn").disabled = true;
        setLeaveMessage("Sending…");

        const result = await getJSON("/api/parent/leave", {
            method: "POST",
            body: JSON.stringify({ student_id: studentId, from_date: fromDate, to_date: toDate, reason }),
        });

        $("leaveBtn").disabled = false;

        if (!result) {
            setLeaveMessage("The leave request could not be sent. Please try again.", "error");
            return;
        }

        $("leaveForm").reset();
        setLeaveMessage("Leave request sent to the teacher.", "success");
        await loadLeave();
    }

    async function loadLeave() {
        const rows = await getJSON("/api/parent/leave");
        const list = Array.isArray(rows) ? rows : [];

        $("leaveList").innerHTML = list.length
            ? list.map((r) => `
                <div class="notice-row">
                    <div>
                        <h4>${esc(r.student_name || "Student")} ${statusPill(r.status)}</h4>
                        <p style="white-space:pre-wrap;">${esc(r.reason)}</p>
                        <p class="muted">
                            ${fmtDate(r.from_date)} → ${fmtDate(r.to_date)}
                            ${r.decided_by ? ` · Decided by ${esc(r.decided_by)}` : " · Waiting for the teacher"}
                        </p>
                    </div>
                </div>`).join("")
            : `<p class="empty-note">You have not applied for leave yet.</p>`;
    }

    function renderComplaints(data) {
        $("complaintsList").innerHTML = data.complaints.length
            ? data.complaints.map((c) => `
                <div class="notice-row">
                    <div>
                        <h4>${esc(c.subject)} ${statusPill(c.status)}</h4>
                        <p>${esc(c.message)}</p>
                        <p class="muted">
                            ${c.student_name ? `About ${esc(c.student_name)} · ` : ""}
                            ${fmtDate(c.created_at)}
                        </p>
                        ${c.response ? `
                            <div class="card" style="padding:12px;margin-top:10px;background:var(--blue-light);">
                                <strong>Teacher response</strong>
                                <p style="margin:6px 0 0;">${esc(c.response)}</p>
                                <p class="muted" style="margin:4px 0 0;">By ${esc(c.responded_by || "Teacher")} · ${fmtDate(c.responded_at)}</p>
                            </div>` : `<p class="muted">Waiting for a teacher response.</p>`}
                    </div>
                </div>`).join("")
            : `<p class="empty-note">You have not raised any complaints yet.</p>`;
    }

    function renderNotices(data) {
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

    function fillComplaintSelect(data) {
        $("complaintChild").innerHTML = data.children
            .map((child) => `<option value="${child.profile.id}">${esc(child.profile.full_name)} — ${esc(child.profile.class_name)}</option>`)
            .join("");
    }

    async function submitComplaint(event) {
        event.preventDefault();

        const studentId = Number($("complaintChild").value);
        const subject = $("complaintSubject").value.trim();
        const message = $("complaintMessage").value.trim();

        if (!studentId || !subject || !message) {
            setComplaintMessage("Please select your child and fill in both fields.", "error");
            return;
        }

        $("complaintBtn").disabled = true;
        setComplaintMessage("Sending…");

        const result = await getJSON("/api/parent/complaints", {
            method: "POST",
            body: JSON.stringify({ student_id: studentId, subject, message }),
        });

        $("complaintBtn").disabled = false;

        if (!result) {
            setComplaintMessage("Complaint could not be sent. Please try again.", "error");
            return;
        }

        $("complaintForm").reset();
        setComplaintMessage("Complaint sent to the teacher.", "success");
        await loadDashboard();
    }

    /* ---------------- result PDF ---------------- */
    function printResult(child, examName) {
        const rows = child.results.filter((r) => r.exam_name === examName);
        if (!rows.length) return;

        const p = child.profile;
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
<title>${esc(p.full_name)} — ${esc(examName)} Result</title>
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
        <div><strong>Student:</strong> ${esc(p.full_name)}</div>
        <div><strong>Class:</strong> ${esc(p.class_name)}</div>
        <div><strong>Admission No:</strong> ${esc(p.admission_no)}</div>
        <div><strong>Roll No:</strong> ${esc(p.roll_no || "—")}</div>
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
    $("changePasswordBtn").addEventListener("click", () => window.TSAOpenPasswordDialog({ api: API, tokenKey: TOKEN_KEY }));
    $("refreshBtn").addEventListener("click", loadDashboard);
    $("complaintForm").addEventListener("submit", submitComplaint);
    $("leaveForm").addEventListener("submit", submitLeave);

    if (localStorage.getItem(TOKEN_KEY)) loadDashboard();
})();
