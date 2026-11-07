/* =========================================================
   Teacher Portal — students, notes, complaints, attendance,
   exam results
========================================================= */
(function () {
    "use strict";

    const API = window.SCHOOL_API || "";
    const TOKEN_KEY = "tsa_teacher_token";
    const USER_KEY = "tsa_teacher_user";
    const STAFF_ROLES = ["teacher", "admin", "owner"];
    const REQUEST_TIMEOUT = 30000;

    const $ = (id) => document.getElementById(id);
    const state = {
        classes: [],
        notes: [],
        students: [],
    };

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
        const map = { present: "ok", paid: "ok", answered: "ok", open: "bad", closed: "warn", leave: "warn", absent: "bad" };
        return `<span class="pill ${map[status] || ""}">${esc(status)}</span>`;
    }

    function setMessage(id, text, kind) {
        const el = $(id);
        if (!el) return;
        el.textContent = text || "";
        el.className = "form-status" + (kind ? " " + kind : "");
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
            if (!res.ok) {
                const detail = data.detail;
                const message = typeof detail === "string"
                    ? detail
                    : Array.isArray(detail)
                        ? detail.map((d) => d.msg).join(", ")
                        : "Request failed";
                throw new Error(message);
            }
            return data;
        } catch (err) {
            console.error(path, err);
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    function showError(err) {
        if (err && err.message) window.alert(err.message);
    }

    /* ---------------- login / logout ---------------- */
    async function login(event) {
        event.preventDefault();
        const email = $("email").value.trim();
        const password = $("password").value;

        if (!email || !password) {
            setMessage("loginMessage", "Both email and password are required.", "error");
            return;
        }

        $("loginBtn").disabled = true;
        setMessage("loginMessage", "Signing in…");

        const data = await getJSON("/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
        });

        if (!data) {
            setMessage("loginMessage", "Login failed or the server timed out. Check your email, password and internet connection.", "error");
            $("loginBtn").disabled = false;
            return;
        }

        if (!data.user || !STAFF_ROLES.includes(data.user.role)) {
            setMessage("loginMessage", "This portal is for teachers and school staff.", "error");
            $("loginBtn").disabled = false;
            return;
        }

        localStorage.setItem(TOKEN_KEY, data.access_token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        $("loginBtn").disabled = false;
        setMessage("loginMessage", "");
        await loadDashboard();
    }

    function logout(showMessage) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        $("dashView").hidden = true;
        $("loginView").hidden = false;
        $("logoutBtn").hidden = true;
        if (showMessage !== false) setMessage("loginMessage", "You have been logged out.");
    }

    /* ---------------- tabs ---------------- */
    const TAB_LOADERS = {
        overview: loadOverview,
        students: loadStudents,
        notes: loadNotes,
        complaints: loadComplaints,
        attendance: prepareAttendance,
        results: prepareResults,
    };

    function switchTab(name) {
        document.querySelectorAll(".portal-tab").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.tab === name);
        });
        document.querySelectorAll(".portal-section").forEach((panel) => {
            panel.hidden = panel.dataset.panel !== name;
        });
        if (TAB_LOADERS[name]) TAB_LOADERS[name]();
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

        if (!user || !STAFF_ROLES.includes(user.role)) {
            logout(false);
            return;
        }

        $("loginView").hidden = true;
        $("dashView").hidden = false;
        $("logoutBtn").hidden = false;
        $("welcomeName").textContent = user.full_name;
        $("profileLine").textContent = `${user.email} · ${user.role === "teacher" ? "Teacher" : user.role === "owner" ? "School Owner" : "Administrator"}`;

        const classes = await getJSON("/api/classes");
        state.classes = Array.isArray(classes) ? classes : [];

        const options = state.classes.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
        ["studentClass", "noteClass", "attClass", "resClass"].forEach((id) => {
            if ($(id)) $(id).innerHTML = options;
        });

        const today = new Date().toISOString().slice(0, 10);
        if ($("attDay")) $("attDay").value = today;

        await loadOverview();
    }

    async function loadOverview() {
        const [summary, notes, complaints] = await Promise.all([
            getJSON("/api/teacher/summary"),
            getJSON("/api/teacher/notes"),
            getJSON("/api/teacher/complaints?status=open"),
        ]);

        const stats = summary || { students: 0, notes: 0, open_complaints: 0 };
        $("teacherStats").innerHTML = `
            <div class="portal-stat"><h3>${esc(stats.students)}</h3><p>Active Students</p></div>
            <div class="portal-stat"><h3>${esc(stats.notes)}</h3><p>Notes Posted</p></div>
            <div class="portal-stat"><h3 class="${stats.open_complaints ? "danger" : ""}">${esc(stats.open_complaints)}</h3><p>Open Complaints</p></div>
            <div class="portal-stat"><h3>${esc((complaints || []).length)}</h3><p>Waiting for Reply</p></div>`;

        const recent = (notes || []).slice(0, 5);
        $("recentNotes").innerHTML = recent.length
            ? recent.map((n) => `
                <div class="portal-list-item">
                    <h4>${esc(n.title)} <span class="pill">${esc(n.category)}</span></h4>
                    <p>${esc(n.message)}</p>
                    <p class="muted">${esc(n.student_name || n.class_name || "Class note")} · ${fmtDate(n.created_at)}</p>
                </div>`).join("")
            : `<p class="portal-empty">No notes posted yet.</p>`;

        const open = (complaints || []).slice(0, 5);
        $("recentComplaints").innerHTML = open.length
            ? open.map((c) => `
                <div class="portal-list-item">
                    <h4>${esc(c.subject)} ${statusPill(c.status)}</h4>
                    <p>${esc(c.message)}</p>
                    <p class="muted">${esc(c.parent_name)} · ${esc(c.student_name || "Student")} · ${fmtDate(c.created_at)}</p>
                </div>`).join("")
            : `<p class="portal-empty">No open complaints.</p>`;
    }

    /* ---------------- students ---------------- */
    async function loadStudents() {
        const query = new URLSearchParams();
        const search = $("studentSearch").value.trim();
        const cls = $("studentClass").value;
        if (search) query.set("search", search);
        if (cls) query.set("class_name", cls);

        const rows = await getJSON(`/api/teacher/students?${query.toString()}`);
        state.students = Array.isArray(rows) ? rows : [];

        $("studentList").innerHTML = state.students.length
            ? `<div class="table-wrap"><table class="portal-table">
                    <thead><tr><th>Name</th><th>Class</th><th>Roll</th><th>Admission No</th><th>Parent</th><th>Phone</th><th>Action</th></tr></thead>
                    <tbody>
                        ${state.students.map((s) => `<tr>
                            <td><strong>${esc(s.full_name)}</strong></td>
                            <td>${esc(s.class_name)}</td>
                            <td>${esc(s.roll_no || "—")}</td>
                            <td>${esc(s.admission_no)}</td>
                            <td>${esc(s.parent_name || "—")}</td>
                            <td>${esc(s.parent_phone || "—")}</td>
                            <td><button class="secondary-button" data-note-student="${s.id}" data-note-class="${esc(s.class_name)}">Add Note</button></td>
                        </tr>`).join("")}
                    </tbody>
                </table></div>`
            : `<p class="portal-empty">No students found.</p>`;

        document.querySelectorAll("[data-note-student]").forEach((btn) => {
            btn.addEventListener("click", () => {
                switchTab("notes");
                $("noteTarget").value = "student";
                $("noteClass").value = btn.dataset.noteClass;
                toggleStudentTarget();
                fillNoteStudents().then(() => {
                    $("noteStudent").value = btn.dataset.noteStudent;
                });
            });
        });
    }

    /* ---------------- notes ---------------- */
    async function fillNoteStudents() {
        const cls = $("noteClass").value;
        const rows = await getJSON(`/api/teacher/students?class_name=${encodeURIComponent(cls)}`);
        const list = Array.isArray(rows) ? rows : [];
        $("noteStudent").innerHTML = list
            .map((s) => `<option value="${s.id}">${esc(s.full_name)} (${esc(s.roll_no || "no roll")})</option>`)
            .join("");
    }

    function toggleStudentTarget() {
        $("noteStudentWrap").hidden = $("noteTarget").value !== "student";
        if ($("noteTarget").value === "student") fillNoteStudents();
    }

    async function submitNote(event) {
        event.preventDefault();

        const target = $("noteTarget").value;
        const class_name = $("noteClass").value;
        const body = {
            class_name,
            title: $("noteTitle").value.trim(),
            message: $("noteMessage").value.trim(),
            category: $("noteCategory").value,
            visible_to_parent: $("noteVisible").checked,
        };

        if (target === "student") {
            const studentId = Number($("noteStudent").value);
            if (!studentId) {
                setMessage("noteStatus", "Please choose a student.", "error");
                return;
            }
            body.student_id = studentId;
        }

        if (!body.title || !body.message) {
            setMessage("noteStatus", "Please fill in the title and message.", "error");
            return;
        }

        $("noteBtn").disabled = true;
        setMessage("noteStatus", "Posting…");

        const result = await getJSON("/api/teacher/notes", {
            method: "POST",
            body: JSON.stringify(body),
        });

        $("noteBtn").disabled = false;

        if (!result) {
            setMessage("noteStatus", "The note could not be posted. Please try again.", "error");
            return;
        }

        $("noteForm").reset();
        $("noteVisible").checked = true;
        $("noteClass").value = class_name;
        toggleStudentTarget();
        setMessage("noteStatus", "Note posted successfully.", "success");
        await loadNotes();
    }

    async function loadNotes() {
        const rows = await getJSON("/api/teacher/notes");
        state.notes = Array.isArray(rows) ? rows : [];

        $("notesList").innerHTML = state.notes.length
            ? state.notes.map((n) => `
                <div class="portal-list-item">
                    <h4>${esc(n.title)} <span class="pill">${esc(n.category)}</span></h4>
                    <p>${esc(n.message)}</p>
                    <p class="muted">
                        ${n.student_name ? `Student: ${esc(n.student_name)}` : `Class: ${esc(n.class_name || "—")}`}
                        · By ${esc(n.teacher_name)} · ${fmtDate(n.created_at)}
                        ${n.visible_to_parent ? "" : " · Hidden from parents"}
                    </p>
                    <div class="portal-actions">
                        <button class="secondary-button" data-delete-note="${n.id}">Delete</button>
                    </div>
                </div>`).join("")
            : `<p class="portal-empty">No notes posted yet.</p>`;

        document.querySelectorAll("[data-delete-note]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                if (!window.confirm("Delete this note?")) return;
                const ok = await getJSON(`/api/teacher/notes/${btn.dataset.deleteNote}`, { method: "DELETE" });
                if (!ok) return;
                await loadNotes();
            });
        });
    }

    /* ---------------- complaints ---------------- */
    async function loadComplaints() {
        const status = $("complaintFilter").value;
        const rows = await getJSON(`/api/teacher/complaints${status ? `?status=${encodeURIComponent(status)}` : ""}`);
        const list = Array.isArray(rows) ? rows : [];

        $("complaintsList").innerHTML = list.length
            ? list.map((c) => `
                <div class="portal-list-item">
                    <h4>${esc(c.subject)} ${statusPill(c.status)}</h4>
                    <p>${esc(c.message)}</p>
                    <p class="muted">
                        Parent: ${esc(c.parent_name)}
                        ${c.student_name ? ` · Student: ${esc(c.student_name)}` : ""}
                        · ${fmtDate(c.created_at)}
                    </p>
                    ${c.response ? `
                        <div class="portal-note">
                            <strong>Your response</strong>
                            ${esc(c.response)}
                            <p class="muted">By ${esc(c.responded_by || "Teacher")} · ${fmtDate(c.responded_at)}</p>
                        </div>` : ""}
                    <div class="portal-note" style="background:var(--light);">
                        <label for="reply-${c.id}" style="margin-top:0;">Reply</label>
                        <textarea id="reply-${c.id}" rows="3" placeholder="Write a reply to the parent">${esc(c.response || "")}</textarea>
                        <div class="portal-actions">
                            <button class="primary-button" data-reply="${c.id}" data-status="answered">Send Reply</button>
                            <button class="secondary-button" data-reply="${c.id}" data-status="closed">Close Complaint</button>
                        </div>
                    </div>
                </div>`).join("")
            : `<p class="portal-empty">No complaints found.</p>`;

        document.querySelectorAll("[data-reply]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.reply;
                const response = $(`reply-${id}`).value.trim();
                if (!response) {
                    window.alert("Please write a reply first.");
                    return;
                }

                const result = await getJSON(`/api/teacher/complaints/${id}`, {
                    method: "PUT",
                    body: JSON.stringify({ response, status: btn.dataset.status }),
                });

                if (!result) {
                    window.alert("The reply could not be sent. Please try again.");
                    return;
                }

                await loadComplaints();
            });
        });
    }

    /* ---------------- attendance ---------------- */
    function prepareAttendance() {
        if ($("attList").dataset.loaded === "1") return;
        $("attList").innerHTML = `<p class="portal-empty">Choose a class and date, then select Load Class.</p>`;
    }

    async function loadAttendance() {
        const cls = $("attClass").value;
        const day = $("attDay").value;
        if (!cls || !day) return;

        const [students, existing] = await Promise.all([
            getJSON(`/api/teacher/students?class_name=${encodeURIComponent(cls)}`),
            getJSON(`/api/attendance?class_name=${encodeURIComponent(cls)}&day=${day}`),
        ]);

        const rows = Array.isArray(students) ? students : [];
        if (!rows.length) {
            $("attList").innerHTML = `<p class="portal-empty">There are no active students in this class.</p>`;
            return;
        }

        const statusMap = {};
        (Array.isArray(existing) ? existing : []).forEach((a) => {
            statusMap[a.student_id] = a.status;
        });
        rows.forEach((s) => {
            statusMap[s.id] = statusMap[s.id] || "present";
        });

        function render() {
            const present = rows.filter((s) => statusMap[s.id] === "present").length;
            $("attList").innerHTML = `
                <div class="portal-toolbar" style="margin-bottom:12px;">
                    <p style="margin:0;"><strong>${present}</strong> present · <strong>${rows.length - present}</strong> absent / leave</p>
                    <button class="primary-button" id="attSave">Save Attendance</button>
                </div>
                <div class="table-wrap"><table class="portal-table">
                    <thead><tr><th>Roll</th><th>Student</th><th>Status</th></tr></thead>
                    <tbody>
                        ${rows.map((s) => `<tr>
                            <td>${esc(s.roll_no || "—")}</td>
                            <td><strong>${esc(s.full_name)}</strong></td>
                            <td>
                                <div class="portal-actions" data-student="${s.id}" style="margin-top:0;">
                                    ${["present", "absent", "leave"].map((st) =>
                                        `<button class="secondary-button" data-status="${st}" style="${statusMap[s.id] === st ? "background:var(--navy);color:#fff;border-color:var(--navy);" : ""}">${st}</button>`
                                    ).join("")}
                                </div>
                            </td>
                        </tr>`).join("")}
                    </tbody>
                </table></div>`;

            document.querySelectorAll("[data-student]").forEach((row) => {
                row.querySelectorAll("[data-status]").forEach((btn) => {
                    btn.addEventListener("click", () => {
                        statusMap[Number(row.dataset.student)] = btn.dataset.status;
                        render();
                    });
                });
            });

            $("attSave").addEventListener("click", async () => {
                const records = rows.map((s) => ({ student_id: s.id, status: statusMap[s.id] }));
                const ok = await getJSON("/api/attendance", {
                    method: "POST",
                    body: JSON.stringify({ class_name: cls, day, records }),
                });
                if (ok) window.alert("Attendance saved.");
            });
        }

        render();
    }

    /* ---------------- results ---------------- */
    function prepareResults() {
        if ($("resList").dataset.loaded === "1") return;
        $("resList").innerHTML = `<p class="portal-empty">Fill in the exam details, then select Load Students.</p>`;
    }

    async function loadResultStudents() {
        const exam = $("resExam").value.trim();
        const cls = $("resClass").value;
        const subject = $("resSubject").value.trim();
        const total = Number($("resTotal").value);

        if (!exam || !cls || !subject || !total) {
            window.alert("Please fill in the exam name, class, subject and total marks.");
            return;
        }

        const rows = await getJSON(`/api/teacher/students?class_name=${encodeURIComponent(cls)}`);
        const students = Array.isArray(rows) ? rows : [];

        if (!students.length) {
            $("resList").innerHTML = `<p class="portal-empty">There are no active students in this class.</p>`;
            return;
        }

        $("resList").innerHTML = `
            <p class="muted">${esc(exam)} · ${esc(cls)} · ${esc(subject)} (out of ${esc(total)})</p>
            <div class="table-wrap"><table class="portal-table">
                <thead><tr><th>Student</th><th>Marks Obtained</th></tr></thead>
                <tbody>
                    ${students.map((s) => `<tr>
                        <td><strong>${esc(s.full_name)}</strong> (${esc(s.roll_no || "no roll")})</td>
                        <td><input type="number" min="0" max="${esc(total)}" step="0.5" data-marks="${s.id}" style="width:120px;"></td>
                    </tr>`).join("")}
                </tbody>
            </table></div>
            <div class="portal-actions">
                <button class="primary-button" id="resSave">Save Results</button>
            </div>`;

        $("resSave").addEventListener("click", async () => {
            const marks = [];
            document.querySelectorAll("[data-marks]").forEach((input) => {
                if (input.value === "") return;
                marks.push({ student_id: Number(input.dataset.marks), marks_obtained: Number(input.value) });
            });

            if (!marks.length) {
                window.alert("Please enter marks for at least one student.");
                return;
            }

            const result = await getJSON("/api/results/bulk", {
                method: "POST",
                body: JSON.stringify({
                    exam_name: exam,
                    subject,
                    total_marks: total,
                    marks,
                }),
            });

            if (result) window.alert(`${result.saved} student result(s) saved.`);
        });
    }

    /* ---------------- start ---------------- */
    $("year").textContent = new Date().getFullYear();
    $("loginForm").addEventListener("submit", login);
    $("logoutBtn").addEventListener("click", () => logout(true));
    $("refreshBtn").addEventListener("click", loadDashboard);

    document.querySelectorAll(".portal-tab").forEach((btn) => {
        btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    $("studentSearchBtn").addEventListener("click", loadStudents);
    $("studentSearch").addEventListener("keydown", (event) => {
        if (event.key === "Enter") loadStudents();
    });

    $("noteTarget").addEventListener("change", toggleStudentTarget);
    $("noteClass").addEventListener("change", () => {
        if ($("noteTarget").value === "student") fillNoteStudents();
    });
    $("noteForm").addEventListener("submit", submitNote);

    $("complaintFilterBtn").addEventListener("click", loadComplaints);
    $("attLoad").addEventListener("click", loadAttendance);
    $("resLoad").addEventListener("click", loadResultStudents);

    if (localStorage.getItem(TOKEN_KEY)) loadDashboard();
})();
