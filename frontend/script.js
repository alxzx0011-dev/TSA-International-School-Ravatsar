/* =====================================================
   BRIGHT FUTURE INTERNATIONAL SCHOOL
   Website JavaScript — live data from the school backend
   ===================================================== */

(function () {
    "use strict";

    const API = window.SCHOOL_API || "http://127.0.0.1:8000";

    /* ---------------------------------------------------------
       1. Helpers
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
        if (!value) return "";
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return "";
        return parsed.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        });
    }

    function partsOf(value) {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        return {
            day: d.toLocaleDateString("en-GB", { day: "2-digit" }),
            month: d.toLocaleDateString("en-GB", { month: "short" }),
            year: d.toLocaleDateString("en-GB", { year: "numeric" }),
        };
    }

    async function getJSON(path) {
        try {
            const response = await fetch(API + path, {
                headers: { Accept: "application/json" },
            });
            if (!response.ok) return null;
            return await response.json();
        } catch (err) {
            return null;
        }
    }

    function apiError(data) {
        const detail = data && data.detail;
        if (typeof detail === "string") return detail;
        if (Array.isArray(detail)) {
            return detail.map((d) => d.msg).join(", ");
        }
        return "Could not reach the school server. Please try again later.";
    }

    /* ---------------------------------------------------------
       2. Mobile navigation
    --------------------------------------------------------- */
    const menuToggle = document.getElementById("menuToggle");
    const navLinks = document.getElementById("navLinks");

    if (menuToggle && navLinks) {
        menuToggle.addEventListener("click", () => {
            const isOpen = navLinks.classList.toggle("open");
            menuToggle.setAttribute("aria-expanded", String(isOpen));
            menuToggle.textContent = isOpen ? "✕" : "☰";
        });

        navLinks.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", () => {
                navLinks.classList.remove("open");
                menuToggle.setAttribute("aria-expanded", "false");
                menuToggle.textContent = "☰";
            });
        });

        document.addEventListener("click", (event) => {
            const inside = navLinks.contains(event.target);
            const onToggle = menuToggle.contains(event.target);
            if (!inside && !onToggle) {
                navLinks.classList.remove("open");
                menuToggle.setAttribute("aria-expanded", "false");
                menuToggle.textContent = "☰";
            }
        });
    }

    const yearElement = document.getElementById("year");
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }

    /* ---------------------------------------------------------
       3. Site settings (phone, email, socials, hero text)
    --------------------------------------------------------- */
    async function loadSettings() {
        const settings = await getJSON("/api/settings");
        if (!settings) return;

        document.querySelectorAll("[data-setting]").forEach((el) => {
            const value = settings[el.dataset.setting];
            if (value) el.textContent = value;
        });

        const footerContact = document.getElementById("footerContact");
        if (footerContact) {
            const rows = [
                settings.address ? `<p>${esc(settings.address)}</p>` : "",
                settings.phone
                    ? `<p><a href="tel:${esc(settings.phone.replace(/[^\d+]/g, ""))}">${esc(settings.phone)}</a></p>`
                    : "",
                settings.email
                    ? `<p><a href="mailto:${esc(settings.email)}">${esc(settings.email)}</a></p>`
                    : "",
            ].filter(Boolean);
            footerContact.innerHTML = rows.join("");
        }

        const socials = document.getElementById("socialLinks");
        if (socials) {
            const labels = [
                ["facebook", "Facebook"],
                ["instagram", "Instagram"],
                ["youtube", "YouTube"],
            ];
            const links = labels
                .filter(([key]) => settings[key])
                .map(([key, label]) => `<a href="${esc(settings[key])}" target="_blank" rel="noopener">${label}</a>`);
            socials.innerHTML = links.join("");
        }
    }

    /* ---------------------------------------------------------
       4. Forms → database (admissions & contact)
    --------------------------------------------------------- */
    function showMessage(el, text, kind) {
        if (!el) return;
        el.textContent = text;
        el.className = "form-status " + (kind || "");
    }

    function wireForm(formId, endpoint, buildBody, statusId, successText) {
        const form = document.getElementById(formId);
        if (!form) return;

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const status = document.getElementById(statusId);
            const button = form.querySelector("button[type=submit]");

            if (button) button.disabled = true;
            showMessage(status, "Sending…");

            try {
                const response = await fetch(API + endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(buildBody(new FormData(form))),
                });

                if (response.status === 201) {
                    showMessage(status, successText, "success");
                    form.reset();
                    return;
                }

                let data = null;
                try {
                    data = await response.json();
                } catch (err) {
                    // ignore non-JSON
                }
                showMessage(status, apiError(data), "error");
            } catch (err) {
                showMessage(status, "Network problem. Is the backend running?", "error");
            } finally {
                if (button) button.disabled = false;
            }
        });
    }

    wireForm(
        "admissionForm",
        "/api/admissions",
        (fields) => ({
            parent_name: fields.get("parentName"),
            student_name: fields.get("studentName"),
            class_name: fields.get("className"),
            parent_email: fields.get("parentEmail"),
            phone: fields.get("phone"),
            message: fields.get("message") || null,
        }),
        "formMessage",
        "Thank you! Your admission enquiry has been received. Our admissions team will contact you soon."
    );

    wireForm(
        "contactForm",
        "/api/contact",
        (fields) => ({
            full_name: fields.get("fullName"),
            email: fields.get("email"),
            phone: fields.get("phone"),
            subject: SUBJECT_LABELS[fields.get("subject")] || fields.get("subject"),
            message: fields.get("message"),
        }),
        "contactMessage",
        "Message sent successfully! We will get back to you shortly."
    );

    const SUBJECT_LABELS = {
        admission: "Admissions",
        academics: "Academic Programs",
        fees: "School Fees",
        general: "General Enquiry",
        other: "Other",
    };

    /* ---------------------------------------------------------
       5. Notices
    --------------------------------------------------------- */
    async function loadNotices() {
        const list = document.getElementById("noticesList");
        if (!list) return;

        const notices = await getJSON("/api/notices");
        const section = document.getElementById("notices");

        if (!notices || !notices.length) {
            if (section) section.remove();
            return;
        }

        list.innerHTML = notices
            .map(
                (n) => `<article class="notice-item">
                    <span class="notice-date">${esc(fmtDate(n.created_at))}</span>
                    <div>
                        <h3>${esc(n.title)}</h3>
                        <p>${esc(n.message)}</p>
                    </div>
                </article>`
            )
            .join("");
    }

    /* ---------------------------------------------------------
       6. News (+ read popups)
    --------------------------------------------------------- */
    function closeModal() {
        const existing = document.querySelector(".site-modal-backdrop");
        if (existing) existing.remove();
    }

    function openModal(title, bodyHtml) {
        closeModal();
        const backdrop = document.createElement("div");
        backdrop.className = "site-modal-backdrop";
        backdrop.innerHTML = `
            <article class="site-modal" role="dialog" aria-modal="true">
                <button type="button" class="site-modal-close" aria-label="Close">✕</button>
                <h2>${esc(title)}</h2>
                ${bodyHtml}
            </article>`;
        document.body.append(backdrop);
        document.body.style.overflow = "hidden";
        backdrop.addEventListener("click", (event) => {
            if (event.target === backdrop || event.target.closest(".site-modal-close")) {
                backdrop.remove();
                document.body.style.overflow = "";
            }
        });
        document.addEventListener("keydown", function onKey(event) {
            if (event.key === "Escape") {
                closeModal();
                document.body.style.overflow = "";
                document.removeEventListener("keydown", onKey);
            }
        });
    }

    async function loadNews() {
        const grid = document.getElementById("newsGrid");
        if (!grid) return;

        const news = await getJSON("/api/news?limit=6");
        if (!news || !news.length) {
            const section = document.getElementById("news");
            if (section) section.remove();
            return;
        }

        grid.innerHTML = news
            .map(
                (n) => `<article class="news-card">
                    ${
                        n.image_url
                            ? `<img class="news-image" src="${esc(n.image_url)}" alt="${esc(n.title)}" loading="lazy">`
                            : `<div class="news-image news-image-fallback" aria-hidden="true">📰</div>`
                    }
                    <div class="news-body">
                        <time class="news-date">${esc(fmtDate(n.published_at))}</time>
                        <h3>${esc(n.title)}</h3>
                        <p>${esc(n.summary || "")}</p>
                        <button type="button" class="news-more" data-news="${n.id}">Read more →</button>
                    </div>
                </article>`
            )
            .join("");

        grid.querySelectorAll("[data-news]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const item = news.find((n) => String(n.id) === btn.dataset.news);
                if (!item) return;
                openModal(
                    item.title,
                    `
                    <p class="modal-meta">${esc(fmtDate(item.published_at))}</p>
                    ${item.image_url ? `<img src="${esc(item.image_url)}" alt="${esc(item.title)}" style="width:100%;border-radius:12px;max-height:320px;object-fit:cover;">` : ""}
                    <p style="white-space:pre-wrap;line-height:1.8;">${esc(item.content)}</p>`
                );
            });
        });
    }

    /* ---------------------------------------------------------
       7. Events
    --------------------------------------------------------- */
    async function loadEvents() {
        const grid = document.getElementById("eventsGrid");
        if (!grid) return;

        const events = await getJSON("/api/events");
        if (!events || !events.length) {
            const section = document.getElementById("events");
            if (section) section.remove();
            return;
        }

        grid.innerHTML = events
            .map(
                (e) => `<article class="event-card">
                    ${
                        (() => {
                            const p = partsOf(e.event_date);
                            return p
                                ? `<div class="event-datebox"><strong>${esc(p.day)}</strong><span>${esc(p.month)} ${esc(p.year)}</span></div>`
                                : "";
                        })()
                    }
                    <div>
                        <h3>${esc(e.title)}</h3>
                        ${e.location ? `<p class="event-location">📍 ${esc(e.location)}</p>` : ""}
                        ${e.description ? `<p>${esc(e.description)}</p>` : ""}
                    </div>
                </article>`
            )
            .join("");
    }

    /* ---------------------------------------------------------
       8. Gallery (with category filters)
    --------------------------------------------------------- */
    async function loadGallery() {
        const grid = document.getElementById("galleryGrid");
        if (!grid) return;

        const items = await getJSON("/api/gallery");
        if (!items || !items.length) return; // static photos stay as fallback

        const filters = document.getElementById("galleryFilters");
        const categories = [...new Set(items.map((i) => i.category))];

        const render = (category) => {
            const selected = category ? items.filter((i) => i.category === category) : items;
            grid.innerHTML = selected
                .map(
                    (i) => `<article class="gallery-card">
                        <img src="${esc(i.image_url)}" alt="${esc(i.title)}" loading="lazy">
                        <div class="gallery-card-content">
                            <h3>${esc(i.title)}</h3>
                            <p>${esc(i.category)}</p>
                        </div>
                    </article>`
                )
                .join("");
        };

        if (filters && categories.length > 1) {
            filters.innerHTML = `<button class="filter-btn active" data-cat="">All</button>${categories
                .map((c) => `<button class="filter-btn" data-cat="${esc(c)}">${esc(c)}</button>`)
                .join("")}`;
            filters.querySelectorAll("[data-cat]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    filters.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
                    btn.classList.add("active");
                    render(btn.dataset.cat);
                });
            });
        }

        render();
    }

    /* ---------------------------------------------------------
       9. Faculty
    --------------------------------------------------------- */
    async function loadFaculty() {
        const grid = document.getElementById("facultyGrid");
        if (!grid) return;

        const members = await getJSON("/api/faculty");
        if (!members || !members.length) return; // keep the friendly fallback text

        grid.innerHTML = members
            .map(
                (f) => `<article class="faculty-card">
                    <div class="faculty-media">
                        ${
                            f.image_url
                                ? `<img class="faculty-photo" src="${esc(f.image_url)}" alt="${esc(f.name)}" loading="lazy">`
                                : `<div class="faculty-photo faculty-photo-fallback" aria-hidden="true">${esc(f.name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase())}</div>`
                        }
                        <div class="faculty-overlay">
                            <h3>${esc(f.name)}</h3>
                            <p class="faculty-role">${esc(f.designation)}</p>
                        </div>
                    </div>
                    <div class="faculty-info">
                        ${f.subject ? `<p class="faculty-subject">${esc(f.subject)}</p>` : ""}
                        ${f.bio ? `<p class="faculty-bio">${esc(f.bio)}</p>` : ""}
                    </div>
                </article>`
            )
            .join("");
    }

    /* ---------------------------------------------------------
       10. Start
    --------------------------------------------------------- */
    loadSettings();
    loadNotices();
    loadNews();
    loadEvents();
    loadGallery();
    loadFaculty();
})();
