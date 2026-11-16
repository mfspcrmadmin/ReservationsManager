const activeDraftAnimations = new WeakMap();
const winterDraftPhrases = [
  "Preparando borradores con un toque de magia navideña…",
  "Calentando un chocolate mientras llegan tus reservas…",
  "Pidiendo a los elfos que revisen los archivos adjuntos…",
  "Despejando la nieve del camino hacia tu próximo viaje…",
  "Envolviendo tus borradores para regalo…",
  "Poniendo una bufanda a tus referencias de reserva…",
  "Consultando la lista de deseos de tus viajeros…",
  "Encendiendo luces de Navidad para iluminar el itinerario…",
  "Llevando tus emails en trineo hasta la bandeja de borradores…",
  "Horneando galletas de jengibre mientras preparamos tus borradores…",
  "Buscando una habitación con vistas a un paisaje nevado…",
  "Añadiendo una pizca de canela y unos copos de nieve…",
  "Consultando a los duendecillos de Papá Noel…",
  "Preparando el chocolate caliente a los proveedores…",
  "Decorando el árbol de Navidad con tus itinerarios…",
  "Cantando villancicos mientras revisamos tus borradores…"
];

export function stopDraftLoading(modal) {
  const active = activeDraftAnimations.get(modal);
  if (!active) return;
  window.clearInterval(active.timer);
  active.scene.remove();
  modal.classList.remove("has-draft-animation");
  activeDraftAnimations.delete(modal);
}

export function startDraftLoading(modal, spinner) {
  stopDraftLoading(modal);
  spinner.hidden = false;
  const scene = document.createElement("div");
  scene.className = "draft-loading-scene";
  // Decorative illustration; the existing modal text describes the operation.
  scene.innerHTML = `<svg class="draft-loading-illustration" viewBox="0 0 240 158" aria-hidden="true">
    <circle cx="174" cy="54" r="35" fill="#edf6fa"/>
    <ellipse cx="120" cy="141" rx="83" ry="8" fill="#e2edf2"/>
    <g class="draft-sparkles" fill="#d4aa4c">
      <path d="m44 42 2 5 5 2-5 2-2 5-2-5-5-2 5-2Zm161 40 2 4 4 2-4 2-2 4-2-4-4-2 4-2Z"/>
    </g>
    <g class="draft-tree">
      <rect x="174" y="119" width="10" height="21" rx="2" fill="#96734e"/>
      <path d="m179 44-23 32h11l-23 30h13l-18 24h80l-18-24h13l-23-30h11Z" fill="#43866e"/>
      <path d="m158 79 21-29 21 29m-45 29h48" fill="none" stroke="#dceef0" stroke-width="4" stroke-linecap="round"/>
      <path d="m179 29 3 8 9 1-7 6 2 9-7-5-7 5 2-9-7-6 9-1Z" fill="#e9bd59"/>
      <g fill="#db7474"><circle cx="172" cy="89" r="3"/><circle cx="190" cy="114" r="3"/></g>
      <g fill="#f4cf77"><circle cx="185" cy="72" r="3"/><circle cx="164" cy="117" r="3"/></g>
    </g>
    <g class="draft-snowman">
      <ellipse cx="94" cy="117" rx="28" ry="25" fill="#fff" stroke="#bdd5df" stroke-width="2"/>
      <circle cx="94" cy="76" r="21" fill="#fff" stroke="#bdd5df" stroke-width="2"/>
      <path d="M75 63q3-27 31-24l8 24Z" fill="#c95861"/>
      <rect x="72" y="58" width="44" height="9" rx="4" fill="#fff" stroke="#bdd5df"/>
      <circle cx="107" cy="39" r="6" fill="#fff" stroke="#bdd5df"/>
      <circle cx="87" cy="76" r="2" fill="#3f5967"/><circle cx="100" cy="76" r="2" fill="#3f5967"/>
      <path d="m94 81 13 4-13 3Z" fill="#e9a15e"/>
      <path d="M86 90q8 6 15 0" fill="none" stroke="#3f5967" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M76 96q18 8 37 0l-1 9q-18 7-36-1Z" fill="#c95861"/>
      <path d="m103 102 8 1 4 21-10 1Z" fill="#c95861"/>
      <circle cx="93" cy="114" r="2" fill="#3f5967"/><circle cx="93" cy="127" r="2" fill="#3f5967"/>
      <path d="m68 111-16-12m5 4-1-8m64 16 17-13" fill="none" stroke="#96734e" stroke-width="3" stroke-linecap="round"/>
    </g>
    <g class="draft-envelope"><rect x="124" y="91" width="35" height="25" rx="4" fill="#fffaf0" stroke="#ba9550" stroke-width="2"/><path d="m126 94 15 11 16-11" fill="none" stroke="#ba9550" stroke-width="2"/><path d="m139 108 3-3 3 3-3 3Z" fill="#c95861"/></g>
    <g class="draft-snowflake" stroke="#96bacd" stroke-width="2" stroke-linecap="round"><path d="M49 76v12m-6-6h12m-10-4 8 8m0-8-8 8"/></g>
    <g class="draft-snowflake draft-snowflake--second" stroke="#96bacd" stroke-width="2" stroke-linecap="round"><path d="M135 30v12m-6-6h12m-10-4 8 8m0-8-8 8"/></g>
  </svg><p class="draft-loading-phrase" aria-hidden="true"></p>`;
  const phrase = scene.querySelector("p");
  let index = Math.floor(Math.random() * winterDraftPhrases.length);
  phrase.textContent = winterDraftPhrases[index];
  spinner.insertAdjacentElement("afterend", scene);
  modal.classList.add("has-draft-animation");
  const timer = window.setInterval(() => {
    if (modal.hidden || !modal.isConnected) { stopDraftLoading(modal); return; }
    index = (index + 1) % winterDraftPhrases.length;
    phrase.textContent = winterDraftPhrases[index];
  }, 4600);
  activeDraftAnimations.set(modal, { scene, timer });
}
