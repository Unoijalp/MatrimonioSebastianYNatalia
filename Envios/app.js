const URL_APP_SCRIPT = 'https://script.google.com/macros/s/AKfycbzIOEHkVdPi_lP1Y_jxnCFpif2EXKe56K46JPtPf-xdDUykYrfTVf2bjIztYqIZjl0/exec';

const listaInvitadosEl = document.getElementById('lista-invitados');
const estadoCargaEl = document.getElementById('estado-carga');
const estadoVacioEl = document.getElementById('estado-vacio');

const modalOverlay = document.getElementById('modal-overlay');
const modalNombre = document.getElementById('modal-nombre');
const modalCancelar = document.getElementById('modal-cancelar');
const modalConfirmar = document.getElementById('modal-confirmar');

let invitadoSeleccionado = null; // { codigo, tarjetaEl }

document.addEventListener('DOMContentLoaded', cargarInvitados);

async function cargarInvitados() {
  try {
    const respuesta = await fetch(`${URL_APP_SCRIPT}?action=list`);
    const resultado = await respuesta.json();

    estadoCargaEl.classList.add('oculto');

    if (!resultado.ok) {
      throw new Error(resultado.error || 'Error al obtener datos');
    }

    if (resultado.data.length === 0) {
      estadoVacioEl.classList.remove('oculto');
      return;
    }

    renderizarInvitados(resultado.data);

  } catch (error) {
    estadoCargaEl.innerHTML = `<p>⚠️ Ocurrió un error al cargar la lista: ${error.message}</p>`;
  }
}

function renderizarInvitados(invitados) {
  listaInvitadosEl.innerHTML = '';

  invitados.forEach((invitado) => {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'tarjeta-invitado';
    tarjeta.dataset.codigo = invitado.codigo;

    tarjeta.innerHTML = `
      <div class="nombre-invitado">${invitado.nombre}</div>
    `;

    tarjeta.addEventListener('click', () => abrirModal(invitado.codigo, invitado.nombre, tarjeta));

    listaInvitadosEl.appendChild(tarjeta);
  });
}

function abrirModal(codigo, nombre, tarjetaEl) {
  invitadoSeleccionado = { codigo, tarjetaEl };
  modalNombre.textContent = nombre;
  modalOverlay.classList.remove('oculto');
  modalConfirmar.disabled = false;
  modalConfirmar.textContent = 'Sí, enviar';
}

function cerrarModal() {
  modalOverlay.classList.add('oculto');
  invitadoSeleccionado = null;
}

modalCancelar.addEventListener('click', cerrarModal);

// Cerrar si se hace clic fuera de la caja del modal
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) cerrarModal();
});

modalConfirmar.addEventListener('click', async () => {
  if (!invitadoSeleccionado) return;

  const { codigo, tarjetaEl } = invitadoSeleccionado;

  modalConfirmar.disabled = true;
  modalCancelar.disabled = true;
  modalConfirmar.textContent = 'Enviando...';

  // Deshabilitamos la tarjeta localmente de inmediato
  tarjetaEl.classList.add('enviando');

  try {
    await enviarMensaje(codigo, tarjetaEl);
  } finally {
    modalCancelar.disabled = false;
  }
});

async function enviarMensaje(codigo, tarjetaEl) {
  try {
    // 1. Obtener teléfono y mensaje
    const respuesta = await fetch(`${URL_APP_SCRIPT}?action=getContact&codigo=${encodeURIComponent(codigo)}`);
    const resultado = await respuesta.json();

    if (!resultado.ok) {
      throw new Error(resultado.error || 'No se pudo obtener el contacto');
    }

    const numero = limpiarNumero(resultado.telefono);
    const mensaje = resultado.mensaje || '';
    const mensajeCodificado = encodeURIComponent(mensaje);
    const linkWhatsApp = `https://wa.me/${numero}?text=${mensajeCodificado}`;

    // 2. Marcar como enviado en la hoja (columna D -> "SI")
    const respuestaMarcar = await fetch(`${URL_APP_SCRIPT}?action=markSent&codigo=${encodeURIComponent(codigo)}`);
    const resultadoMarcar = await respuestaMarcar.json();

    if (!resultadoMarcar.ok) {
      // No detenemos el envío por esto, pero avisamos
      console.warn('No se pudo actualizar el estado en la hoja:', resultadoMarcar.error);
    }

    // 3. Marcar visualmente como enviada (queda deshabilitada de forma permanente)
    tarjetaEl.classList.remove('enviando');
    tarjetaEl.classList.add('enviada');

    cerrarModal();

    // 4. Redirigir a WhatsApp
    window.location.href = linkWhatsApp;

  } catch (error) {
    alert(`Error: ${error.message}`);
    tarjetaEl.classList.remove('enviando');
    cerrarModal();
  }
}

function limpiarNumero(numero) {
  return String(numero).replace(/\D/g, '');
}