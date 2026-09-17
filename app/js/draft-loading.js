const activeDraftAnimations = new WeakMap();
const autumnDraftPhrases = [
  "Abriendo el paraguas para resguardar tus servicios…",
  "Convenciendo a septiembre de que agosto ya terminó…",
  "Barriendo las hojas de otoño del CRM…",
  "Poniendo chubasqueros diminutos a tus reservas…",
  "Enseñando a los proveedores la rutina de la vuelta al cole…",
  "Preparando un cafecito para tus referencias de reserva…",
  "Arropando las plantillas de email con una rebeca…",
  "Pidiendo a las nubes que respeten el itinerario…",
  "Ordenando las reservas antes de que caigan las hojas…",
  "Metiendo un paraguas entre el hotel y el traslado…",
  "Convenciendo a los borradores de salir del modo verano…",
  "Manteniendo tus servicios secos y tus emails en orden…"
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
  spinner.hidden = true;
  const scene = document.createElement("div");
  scene.className = "draft-loading-scene";
  // Decorative illustration; the existing modal text describes the operation.
  scene.innerHTML = `<svg class="draft-loading-illustration" viewBox="0 0 240 158" aria-hidden="true">
    <ellipse cx="120" cy="141" rx="77" ry="8" fill="#dcece5"/>
    <g class="draft-rain" stroke="#89bcb9" stroke-width="2.5" stroke-linecap="round">
      <path d="m35 28-3 8m32-19-3 8m108-2-3 8m33 11-3 8m-153 8-3 8m139 4-3 8"/>
    </g>
    <g class="draft-envelope"><rect x="161" y="95" width="35" height="25" rx="4" fill="#fffaf0" stroke="#b88649" stroke-width="2"/><path d="m163 98 15 11 16-11" fill="none" stroke="#b88649" stroke-width="2"/></g>
    <g class="draft-courier">
      <path d="m105 120-3 17m21-17 6 17" stroke="#374e48" stroke-width="9" stroke-linecap="round"/>
      <path d="M99 94q13-12 27 0l8 29H91Z" fill="#e9ae4b" stroke="#b9802f" stroke-width="2"/>
      <circle cx="113" cy="79" r="13" fill="#ebba95"/>
      <path d="M100 77q-2-17 15-14 12 1 12 12l-9-3-5-5-5 9Z" fill="#5a443a"/>
      <path d="m111 84 5 1" stroke="#946249" stroke-width="2" stroke-linecap="round"/>
      <circle cx="118" cy="78" r="1.5" fill="#374e48"/>
      <path d="m122 96 13 5 7-14" fill="none" stroke="#e9ae4b" stroke-width="9" stroke-linecap="round"/>
      <g class="draft-umbrella"><path d="M143 47v49q0 9-7 7" fill="none" stroke="#405e56" stroke-width="3" stroke-linecap="round"/>
        <path d="M98 49q7-35 45-35t45 35q-12-11-23 0-11-11-22 0-12-11-23 0-11-11-22 0" fill="#38907a" stroke="#256a59" stroke-width="2"/>
        <path d="M120 49q3-25 23-35 21 13 22 35M143 14V9" fill="none" stroke="#256a59" stroke-width="2"/>
      </g>
    </g>
    <g class="draft-leaf" fill="#cc7846"><path d="M52 98q23-6 15 16-18 7-15-16"/><path d="m54 113 12-12" stroke="#9a542e" stroke-width="1.5"/></g>
  </svg><p class="draft-loading-phrase" aria-hidden="true"></p>`;
  const phrase = scene.querySelector("p");
  let index = Math.floor(Math.random() * autumnDraftPhrases.length);
  phrase.textContent = autumnDraftPhrases[index];
  spinner.insertAdjacentElement("afterend", scene);
  modal.classList.add("has-draft-animation");
  const timer = window.setInterval(() => {
    if (modal.hidden || !modal.isConnected) { stopDraftLoading(modal); return; }
    index = (index + 1) % autumnDraftPhrases.length;
    phrase.textContent = autumnDraftPhrases[index];
  }, 4600);
  activeDraftAnimations.set(modal, { scene, timer });
}
