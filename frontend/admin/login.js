/* Admin login */
(function () {
    const API = window.SCHOOL_API || "http://127.0.0.1:8000";
    const TOKEN_KEY = "tsa_admin_token";
    const USER_KEY = "tsa_admin_user";

    // Already signed in? Go straight to the dashboard.
    if (localStorage.getItem(TOKEN_KEY)) {
        window.location.replace("dashboard.html");
        return;
    }

    const form = document.getElementById("loginForm");
    const errorBox = document.getElementById("error");
    const submitBtn = document.getElementById("submitBtn");

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        errorBox.textContent = "";

        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;

        if (!email || !password) {
            errorBox.textContent = "Email and password are required.";
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Signing in…";

        try {
            const response = await fetch(`${API}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });

            let data = null;
            try {
                data = await response.json();
            } catch (ignored) {
                // non-JSON response
            }

            if (!response.ok) {
                const detail = data && data.detail;
                throw new Error(
                    typeof detail === "string"
                        ? detail
                        : "Login failed. Please try again."
                );
            }

            if (!data || !data.user || data.user.role !== "admin") {
                throw new Error("This account does not have admin access.");
            }

            localStorage.setItem(TOKEN_KEY, data.access_token);
            localStorage.setItem(USER_KEY, JSON.stringify(data.user));
            window.location.replace("dashboard.html");
        } catch (error) {
            errorBox.textContent = error.message;
            submitBtn.disabled = false;
            submitBtn.textContent = "Sign In";
        }
    });
})();
