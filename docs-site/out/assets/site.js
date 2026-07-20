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

const heroParallax = () => {
  const pipeline = document.querySelector(".hero-pipeline");
  if (!pipeline || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  let ticking = false;

  const update = () => {
    const scrollY = window.scrollY || 0;
    const offset = Math.min(scrollY * 0.12, 36);
    pipeline.style.setProperty("--parallax-y", `${offset}px`);
    ticking = false;
  };

  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true }
  );

  update();
};

document.addEventListener("DOMContentLoaded", () => {
  reveal();
  mobileNav();
  heroParallax();
});
