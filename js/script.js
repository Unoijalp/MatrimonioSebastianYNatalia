/* =========================================================
   CONFIGURACIÓN
   Pega aquí la URL de tu Web App de Google Apps Script
   (termina en /exec). La obtienes al hacer "Implementar
   > Nueva implementación > Aplicación web".

   iniciar server local
   npx --yes serve -p 3000
   ========================================================= */
const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzN7f3pPhAhxR8LxIOn5tovSE-Yeka6etf10gS0AkbygHmUBbOpfyHLjT6Kta3kXIwA/exec", // ej: https://script.google.com/macros/s/XXXXX/exec
  PARAM_NAME: "fam", // nombre del parámetro en la URL (?fam=1234)
};

/* =========================================================
   ELEMENTOS DE LAS PANTALLAS DE ESTADO
   ========================================================= */
const loadingScreen = document.getElementById("loading-screen");
const notFoundScreen = document.getElementById("not-found-screen");
const dotNav = document.getElementById("dot-nav");
const main = document.getElementById("main");

function showOnly(screen) {
  loadingScreen.hidden = screen !== "loading";
  notFoundScreen.hidden = screen !== "not-found";
  dotNav.hidden = screen !== "invitation";
  main.hidden = screen !== "invitation";
}

/* =========================================================
   1. LECTURA DEL CÓDIGO EN LA URL
   Ejemplo: https://miweb.com/index.html?fam=1234
   ========================================================= */
function getGuestCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get(CONFIG.PARAM_NAME);
}

/* =========================================================
   2. CONSULTA A GOOGLE APPS SCRIPT (búsqueda del invitado)
   Hace un GET simple (sin preflight CORS) y espera:
   { found: true,  nombre: "Familia Pérez" }
   { found: false }
   ========================================================= */
async function lookupGuest(code) {
  const url = `${CONFIG.APPS_SCRIPT_URL}?action=lookup&code=${encodeURIComponent(code)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("No se pudo conectar con la hoja de invitados.");
  }
  return response.json();
}

/* =========================================================
   3. FLUJO PRINCIPAL DE VERIFICACIÓN
   ========================================================= */
async function initGuestVerification() {
  showOnly("loading");

  const code = getGuestCodeFromUrl();

  if (!code) {
    showOnly("not-found");
    return;
  }

  try {
    const data = await lookupGuest(code);

    if (data.found) {
      document.getElementById("guest-name").textContent = data.nombre;
      showOnly("invitation");
      initDotNav();
      initSectionVideo();
      initRsvp(code);
    } else {
      showOnly("not-found");
    }
  } catch (error) {
    console.error(error);
    // Si falla la conexión, tratamos igual que "no encontrado"
    // para no dejar la pantalla de carga infinita.
    showOnly("not-found");
  }
}

/* =========================================================
   4. NAVEGACIÓN POR PUNTOS
   Detecta qué sección está visible y marca su punto activo.
   Solo se activa una vez se muestra la invitación.
   ========================================================= */
function initDotNav() {
  const sections = document.querySelectorAll("[data-section]");
  const dots = document.querySelectorAll(".dot-nav__dot");

  const dotBySectionId = {};
  dots.forEach((dot) => {
    const id = dot.getAttribute("href").replace("#", "");
    dotBySectionId[id] = dot;
  });

  function markActiveDot(sectionId) {
    dots.forEach((dot) => dot.classList.remove("is-active"));
    const activeDot = dotBySectionId[sectionId];
    if (activeDot) activeDot.classList.add("is-active");
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) markActiveDot(entry.target.id);
      });
    },
    { threshold: 0.6 }
  );

  sections.forEach((section) => observer.observe(section));
}

/* =========================================================
   VIDEO DE SECCIÓN
   Sin controles. Reproduce en bucle solo mientras la
   sección está visible; se pausa al salir de pantalla.
   ========================================================= */
function initSectionVideo() {
  const video = document.querySelector(".section__video");
  if (!video) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    },
    { threshold: 0.5 }
  );

  observer.observe(video.closest("section") || video);
}

/* =========================================================
   5. CONFIRMACIÓN DE ASISTENCIA (botones + modal + Apps Script)
   ========================================================= */
function initRsvp(guestCode) {
  const buttons = document.querySelectorAll(".rsvp-btn");
  const modal = document.getElementById("rsvp-modal");
  const modalText = document.getElementById("rsvp-modal-text");
  const modalConfirmBtn = document.getElementById("rsvp-modal-confirm");
  const modalCancelBtn = document.getElementById("rsvp-modal-cancel");
  const feedback = document.getElementById("rsvp-feedback");

  let respuestaSeleccionada = null;

  function openModal(respuesta) {
    respuestaSeleccionada = respuesta;
    modalText.textContent =
      respuesta === "SI"
        ? "¿Confirmas que asistirás a nuestra boda?"
        : "¿Confirmas que no podrás acompañarnos?";
    modal.hidden = false;
  }

  function closeModal() {
    modal.hidden = true;
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => openModal(btn.dataset.respuesta));
  });

  modalCancelBtn.addEventListener("click", closeModal);

  modalConfirmBtn.addEventListener("click", async () => {
    closeModal();
    buttons.forEach((btn) => (btn.disabled = true));
    feedback.textContent = "Enviando tu respuesta...";

    try {
      await sendRsvp(guestCode, respuestaSeleccionada);
      feedback.textContent =
        respuestaSeleccionada === "SI"
          ? "¡Gracias por confirmar! Te esperamos con mucha alegría."
          : "Gracias por avisarnos, ¡te extrañaremos ese día!";
    } catch (error) {
      console.error(error);
      feedback.textContent =
        "No pudimos enviar tu respuesta. Por favor intenta de nuevo.";
      buttons.forEach((btn) => (btn.disabled = false));
    }
  });
}

/* =========================================================
   6. ENVÍO DE LA RESPUESTA A GOOGLE APPS SCRIPT
   Se usa 'text/plain' como Content-Type a propósito: así el
   navegador no dispara una petición OPTIONS (preflight) que
   Apps Script no responde, y el POST llega directo.
   ========================================================= */
async function sendRsvp(code, respuesta) {
  const response = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ code, respuesta }),
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || "Error desconocido al guardar la respuesta.");
  }
  return data;
}

/* =========================================================
   CONTADOR REGRESIVO PARA EL EVENTO
   ========================================================= */
   function initCountdown() {
    // Fecha y hora del evento (ajusta según la ceremonia)
    const eventDate = new Date("2026-11-22T14:00:00");
  
    const elDays = document.getElementById("countdown-days");
    const elHours = document.getElementById("countdown-hours");
    const elMinutes = document.getElementById("countdown-minutes");
    const elSeconds = document.getElementById("countdown-seconds");
  
    function pad(num) {
      return String(num).padStart(2, "0");
    }
  
    function updateCountdown() {
      const now = new Date();
      const diff = eventDate - now;
  
      if (diff <= 0) {
        elDays.textContent = "00";
        elHours.textContent = "00";
        elMinutes.textContent = "00";
        elSeconds.textContent = "00";
        clearInterval(timerId);
        return;
      }
  
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      const seconds = Math.floor((diff / 1000) % 60);
  
      elDays.textContent = pad(days);
      elHours.textContent = pad(hours);
      elMinutes.textContent = pad(minutes);
      elSeconds.textContent = pad(seconds);
    }
  
    updateCountdown(); // primer pintado inmediato, sin esperar 1 segundo
    const timerId = setInterval(updateCountdown, 1000);
  }


  /* =========================================================
   ANIMACIÓN: CORAZONES FLOTANTES
   Ajusta estos valores para cambiar frecuencia, tamaño y
   movimiento sin tocar el resto del código.
   ========================================================= */
const HEARTS_CONFIG = {
  spawnInterval: 700,   // ms entre cada corazón nuevo (menor = más frecuente)
  minSize: 10,          // px, tamaño mínimo del corazón
  maxSize: 36,          // px, tamaño máximo del corazón
  minDuration: 4000,    // ms, duración mínima de la animación de un corazón
  maxDuration: 7500,    // ms, duración máxima
  driftRange: 60,       // px, qué tanto se puede mover en X (izq/der)
  riseMin: 20,           // px, cuánto sube como mínimo en Y
  riseMax: 80,           // px, cuánto sube como máximo en Y
  colors: [
    "var(--color-gold)",
    "var(--color-gold-light)",
    "var(--color-burgundy-soft)",
  ],
};

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function createHeart(container) {
  const heart = document.createElement("div");
  heart.className = "heart";

  const size = randomBetween(HEARTS_CONFIG.minSize, HEARTS_CONFIG.maxSize);
  const duration = randomBetween(HEARTS_CONFIG.minDuration, HEARTS_CONFIG.maxDuration);
  const left = randomBetween(6, 94);  // % dentro de la sección
  const top = randomBetween(10, 90);  // % dentro de la sección

  // Movimiento aleatorio: en X puede ir a izquierda o derecha,
  // en Y siempre sube (valores negativos) para simular flotar.
  const tx = randomBetween(-HEARTS_CONFIG.driftRange, HEARTS_CONFIG.driftRange);
  const ty = -randomBetween(HEARTS_CONFIG.riseMin, HEARTS_CONFIG.riseMax);

  const color =
    HEARTS_CONFIG.colors[Math.floor(Math.random() * HEARTS_CONFIG.colors.length)];

  heart.style.left = `${left}%`;
  heart.style.top = `${top}%`;
  heart.style.setProperty("--heart-size", `${size}px`);
  heart.style.setProperty("--heart-color", color);
  heart.style.setProperty("--tx", `${tx}px`);
  heart.style.setProperty("--ty", `${ty}px`);
  heart.style.animationDuration = `${duration}ms`;

  heart.innerHTML = `
    <svg viewBox="0 0 32 29" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 29C16 29 0 18.5 0 8.7 0 3.9 3.9 0 8.7 0c2.6 0 5 1.2 6.6 3.2C16.9 1.2 19.3 0 21.9 0 26.7 0 30.6 3.9 30.6 8.7 30.6 18.5 16 29 16 29Z"/>
    </svg>
  `;

  container.appendChild(heart);

  // Limpieza: se elimina del DOM cuando termina su animación
  setTimeout(() => heart.remove(), duration);
}

/**
 * Detecta qué sección está visible en pantalla y, cada cierto
 * tiempo, agrega un corazón dentro de su .hearts-container.
 * Así la animación "viaja" con el usuario a cualquier sección.
 */
function initHeartsAnimation() {
  const sections = document.querySelectorAll(".section");
  let activeContainer = null;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          activeContainer = entry.target.querySelector(".hearts-container");
        }
      });
    },
    { threshold: 0.6 }
  );

  sections.forEach((section) => observer.observe(section));

  setInterval(() => {
    if (activeContainer) createHeart(activeContainer);
  }, HEARTS_CONFIG.spawnInterval);
}



/* =========================================================
   ANIMACIÓN: REVEAL AL ENTRAR EN PANTALLA
   Cuando una sección se hace visible, agrega "is-visible" a
   sus elementos con .reveal-fade / .hairline--animated.
   Al salir de pantalla, se quita para que se repita si el
   usuario vuelve a pasar por esa sección.
   ========================================================= */
   function initRevealAnimations() {
    const sections = document.querySelectorAll(".section");
  
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const revealEls = entry.target.querySelectorAll(
            ".reveal-fade, .hairline--animated"
          );
  
          if (entry.isIntersecting) {
            revealEls.forEach((el) => el.classList.add("is-visible"));
          } else {
            revealEls.forEach((el) => el.classList.remove("is-visible"));
          }
        });
      },
      { threshold: 0.35 } // se activa cuando ~35% de la sección es visible
    );
  
    sections.forEach((section) => observer.observe(section));
  }






/* =========================================================
   INICIO
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  initGuestVerification(); 
  initCountdown();         //  no depende de la verificación del invitado
  initHeartsAnimation();
  initRevealAnimations(); 
});