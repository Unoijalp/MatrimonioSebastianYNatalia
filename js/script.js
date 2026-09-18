/* =========================================================
   CONFIGURACIÓN
   Pega aquí la URL de tu Web App de Google Apps Script
   (termina en /exec). La obtienes al hacer "Implementar
   > Nueva implementación > Aplicación web".

   iniciar server local
   npx --yes serve -p 3000
   ========================================================= */
const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwe4CyZs3tHCTSLfxhPwbqePQHsu8iD3zpy6CsCTp-I-Xcxx5nvnptW6hPID8InO-3d/exec",
  PARAM_NAME: "fam", // nombre del parámetro en la URL (?fam=1234)
};

/* =========================================================
   CONFIGURACIÓN DE RED
   ========================================================= */
const NETWORK_CONFIG = {
  maxRetries: 3,
  baseTimeout: 6000,     // timeout del primer intento (cold start más lento)
  retryDelay: 1500,      // espera base entre intentos
};

/* =========================================================
   ELEMENTOS DE LAS PANTALLAS DE ESTADO (actualizado)
   ========================================================= */
const loadingScreen = document.getElementById("loading-screen");
const notFoundScreen = document.getElementById("not-found-screen");
const connectionErrorScreen = document.getElementById("connection-error-screen");
const dotNav = document.getElementById("dot-nav");
const main = document.getElementById("main");

function showOnly(screen) {
  loadingScreen.hidden = screen !== "loading";
  notFoundScreen.hidden = screen !== "not-found";
  connectionErrorScreen.hidden = screen !== "connection-error";
  dotNav.hidden = screen !== "invitation";
  main.hidden = screen !== "invitation";
}

/* =========================================================
   FETCH CON TIMEOUT
   Evita que una petición se quede "colgada" indefinidamente.
   ========================================================= */
function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => {
    clearTimeout(timeoutId);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =========================================================
PING DE CALENTAMIENTO
Se dispara de inmediato al cargar el script (no espera al
DOMContentLoaded), en paralelo con el resto de recursos de
la página. No bloquea nada: si falla, no pasa nada, solo
perdemos el "calentamiento" pero el flujo normal sigue.
========================================================= */
(function warmUpAppsScript() {
  const url = `${CONFIG.APPS_SCRIPT_URL}?action=ping`;
  fetch(url).catch(() => {
    /* silencioso: es solo un intento de precalentar el servidor */
  });
})();

/* =========================================================
   1. LECTURA DEL CÓDIGO EN LA URL
   Ejemplo: https://miweb.com/index.html?fam=1234
   ========================================================= */
function getGuestCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get(CONFIG.PARAM_NAME);
}

/* =========================================================
   CONSULTA A GOOGLE APPS SCRIPT, CON REINTENTOS Y BACKOFF
   Cada intento espera más tiempo que el anterior, y el
   timeout también crece: el cold start es la excepción, no
   la regla, así que solo el primer intento necesita más margen.
   ========================================================= */
async function lookupGuest(code) {
  const url = `${CONFIG.APPS_SCRIPT_URL}?action=lookup&code=${encodeURIComponent(code)}`;
  let lastError;

  for (let attempt = 1; attempt <= NETWORK_CONFIG.maxRetries; attempt++) {
    const timeout = NETWORK_CONFIG.baseTimeout * attempt; // 6s, 12s, 18s

    try {
      const response = await fetchWithTimeout(url, timeout);
      if (!response.ok) throw new Error(`Respuesta HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      console.warn(`Intento ${attempt} falló (timeout ${timeout}ms):`, error.message);
      if (attempt < NETWORK_CONFIG.maxRetries) {
        await wait(NETWORK_CONFIG.retryDelay * attempt); // 1.5s, 3s
      }
    }
  }

  throw lastError;
}

/* =========================================================
   FLUJO PRINCIPAL DE VERIFICACIÓN (actualizado)
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
      initRsvp(code);
    } else {
      // Aquí sí hubo respuesta del servidor: el código no existe
      showOnly("not-found");
    }
  } catch (error) {
    // Aquí NO hubo respuesta válida: fue un problema de red/conexión
    console.error("Error de conexión tras varios intentos:", error);
    showOnly("connection-error");
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
          video.play().catch(() => { });
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
   BOTÓN DE REINTENTAR (pantalla de error de conexión)
   ========================================================= */
document.getElementById("retry-connection-btn").addEventListener("click", () => {
  initGuestVerification();
});



/* =========================================================
   INICIO
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  initGuestVerification();
  initCountdown();         //  no depende de la verificación del invitado
  initHeartsAnimation();
  initRevealAnimations();
});