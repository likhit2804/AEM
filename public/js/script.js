document.addEventListener("DOMContentLoaded", function() {
    // ✅ Auto-open the first unit if no active lecture
    const activeLecture = document.querySelector('.lecture-link.active');
    if (activeLecture) {
        const parentUnit = activeLecture.closest('.unit');
        if (parentUnit) {
            parentUnit.classList.add('open');
            const btn = parentUnit.querySelector('.unit-btn');
            if (btn) btn.innerHTML = btn.textContent.replace("▾", "▴");
        }
    } else {
        const firstUnitBtn = document.querySelector('.unit-btn');
        if (firstUnitBtn) {
            firstUnitBtn.parentElement.classList.add('open');
            firstUnitBtn.innerHTML = firstUnitBtn.textContent.replace("▾", "▴");
        }
    }

    // ✅ Accordion toggle for units
    document.querySelectorAll(".unit-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const unit = btn.parentElement;
            const isAlreadyOpen = unit.classList.contains("open");

            // Close all units first
            document.querySelectorAll(".unit").forEach(u => {
                u.classList.remove("open");
                const btnInside = u.querySelector(".unit-btn");
                if (btnInside) {
                    btnInside.innerHTML = btnInside.textContent.replace("▴", "▾");
                }
            });

            // Toggle clicked one (re-open only if it wasn’t already open)
            if (!isAlreadyOpen) {
                unit.classList.add("open");
                btn.innerHTML = btn.textContent.replace("▾", "▴");
            }
        });
    });

    // ✅ Theme toggle
    const toggleBtn = document.getElementById("theme-toggle");
    if (toggleBtn) {
        // Load saved theme
        if (localStorage.getItem("theme") === "light") {
            document.body.classList.add("light-theme");
            toggleBtn.textContent = "🌙";
        } else {
            toggleBtn.textContent = "☀️";
        }

        toggleBtn.addEventListener("click", () => {
            document.body.classList.toggle("light-theme");

            if (document.body.classList.contains("light-theme")) {
                localStorage.setItem("theme", "light");
                toggleBtn.textContent = "🌙";
            } else {
                localStorage.setItem("theme", "dark");
                toggleBtn.textContent = "☀️";
            }
        });
    }
});

// ✅ Function to switch lecture content
function showLecture(lectureId, clickedElement) {
    // Hide all lecture content
    document.querySelectorAll(".lecture-content").forEach(content => {
        content.style.display = "none";
    });

    // Show the selected lecture content
    const selectedContent = document.getElementById(lectureId);
    if (selectedContent) {
        selectedContent.style.display = "block";
    }

    // Update active state for links
    document.querySelectorAll(".lecture-link").forEach(link => {
        link.classList.remove("active");
    });
    clickedElement.classList.add("active");

    // Ensure parent unit stays open
    const parentUnit = clickedElement.closest('.unit');
    if (parentUnit) {
        parentUnit.classList.add('open');
        const btn = parentUnit.querySelector('.unit-btn');
        if (btn) btn.innerHTML = btn.textContent.replace("▾", "▴");
    }

    // Optional: Refresh MathJax
    if (typeof MathJax !== 'undefined' && MathJax.typeset) {
        MathJax.typeset();
    }
}
