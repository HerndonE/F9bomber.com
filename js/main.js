/* F9bomber.com — main.js */

(() => {
  'use strict';

  // ── Active nav link on scroll ──────────────────────────────────
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.navbar-nav .nav-link[href^="#"]');

  function onScroll() {
    // Use getBoundingClientRect so the threshold is viewport-relative and
    // works correctly regardless of flexbox/sticky layout.
    // A section becomes "current" once its top edge scrolls within 130px of
    // the viewport top (just below the sticky navbar). The last qualifying
    // section wins, which keeps the last section active at the bottom of the page.
    let currentId = null;
    sections.forEach(sec => {
      if (sec.getBoundingClientRect().top <= 130) currentId = sec.id;
    });
    navLinks.forEach(l => l.classList.remove('active'));
    if (currentId) {
      const link = document.querySelector(`.navbar-nav .nav-link[href="#${currentId}"]`);
      if (link) link.classList.add('active');
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ── Close mobile nav on link click ────────────────────────────
  const navbarCollapse = document.getElementById('navbarMain');
  if (navbarCollapse) {
    navbarCollapse.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        const bsCollapse = bootstrap.Collapse.getInstance(navbarCollapse);
        if (bsCollapse) bsCollapse.hide();
      });
    });
  }

  // ── Animated counter for stat numbers ─────────────────────────
  function animateCount(el) {
    const target = parseInt(el.dataset.target, 10);
    const duration = 1200;
    const step = target / (duration / 16);
    let current = 0;
    const tick = () => {
      current = Math.min(current + step, target);
      el.textContent = Math.floor(current).toLocaleString();
      if (current < target) requestAnimationFrame(tick);
    };
    tick();
  }

  const counters = document.querySelectorAll('.stat-num[data-target]');
  if (counters.length && 'IntersectionObserver' in window) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(c => obs.observe(c));
  }

  // ── Navbar shadow on scroll ────────────────────────────────────
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    window.addEventListener('scroll', () => {
      navbar.style.boxShadow = window.scrollY > 10
        ? '0 2px 20px rgba(246,168,0,0.12)'
        : 'none';
    }, { passive: true });
  }
})();
