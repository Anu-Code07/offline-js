const reveal = () => {
  const nodes = document.querySelectorAll(".reveal");

  if (!nodes.length) {
    return;
  }

  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    nodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }

  // Stagger siblings in feature/flow/bench strips for a calmer cascade.
  document.querySelectorAll(".feature-strip, .flow-strip, .bench-strip").forEach((strip) => {
    Array.from(strip.children).forEach((child, index) => {
      if (child.classList.contains("reveal") && !child.style.transitionDelay) {
        child.style.transitionDelay = `${index * 70}ms`;
      }
    });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );

  nodes.forEach((node) => observer.observe(node));

  // Ensure above-the-fold content never stays invisible.
  requestAnimationFrame(() => {
    nodes.forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.95 && rect.bottom > 0) {
        node.classList.add("is-visible");
        observer.unobserve(node);
      }
    });
  });
};

const mobileNav = () => {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector("#site-nav");

  if (!toggle || !nav) {
    return;
  }

  const setOpen = (open) => {
    document.body.classList.toggle("nav-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };

  toggle.addEventListener("click", () => {
    setOpen(!document.body.classList.contains("nav-open"));
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setOpen(false);
    }
  });

  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 860px)").matches) {
      setOpen(false);
    }
  });
};

const copyButtons = () => {
  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.getAttribute("data-copy-target");
      const source = targetId ? document.getElementById(targetId) : null;
      if (!source) {
        return;
      }

      const text = source.textContent ?? "";
      const status = document.getElementById("copy-ai-status");

      try {
        await navigator.clipboard.writeText(text);
        if (status) {
          status.hidden = false;
          window.setTimeout(() => {
            status.hidden = true;
          }, 2000);
        }
        button.textContent = "Copied";
        window.setTimeout(() => {
          button.textContent = "Copy prompt";
        }, 1600);
      } catch {
        // Fallback for older browsers / denied clipboard.
        const range = document.createRange();
        range.selectNodeContents(source);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        if (status) {
          status.hidden = false;
          status.textContent = "Select the prompt and copy manually (Ctrl/⌘+C)";
        }
      }
    });
  });
};

document.addEventListener("DOMContentLoaded", () => {
  reveal();
  mobileNav();
  copyButtons();
});
