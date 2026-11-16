// Rich note editor shared in behavior and storage format with 24hManager.
function element(tag, className = '') { const node = document.createElement(tag); node.className = className; return node; }
function button(text, click) { const node = element('button'); node.type = 'button'; node.textContent = text; node.onclick = click; return node; }
function noteColor(value) {
  if (/^#[0-9a-f]{6}$/i.test(value || '')) return value.toLowerCase();
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(value || '');
  return rgb ? '#' + rgb.slice(1).map(v => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('') : '';
}
export function renderNote(target, note) {
  target.replaceChildren();
  let cursor = 0;
  for (const span of note.formatting ?? []) {
    target.append(document.createTextNode(note.body.slice(cursor, span.start)));
    let node = document.createTextNode(note.body.slice(span.start, span.end));
    if (span.bold) { const strong = element('strong'); strong.append(node); node = strong; }
    if (span.underline) { const underline = element('u'); underline.append(node); node = underline; }
    if (noteColor(span.color) || noteColor(span.backgroundColor)) {
      const colored = element('span');
      colored.style.color = noteColor(span.color);
      colored.style.backgroundColor = noteColor(span.backgroundColor);
      colored.append(node); node = colored;
    }
    target.append(node); cursor = span.end;
  }
  target.append(document.createTextNode(note.body.slice(cursor)));
}
export function noteEditor(label, note = { body: '' }) {
  const node = element('div', 'note-editor'), toolbar = element('div', 'note-format-toolbar');
  toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', 'Note formatting');
  const input = element('div', 'note-rich-input'); input.contentEditable = 'true'; input.setAttribute('role', 'textbox'); input.setAttribute('aria-multiline', 'true'); input.setAttribute('aria-label', label); input.dataset.placeholder = 'Add an internal note...';
  renderNote(input, note);
  let savedRange;
  const rememberSelection = () => {
    const selection = window.getSelection();
    if (selection.rangeCount && input.contains(selection.getRangeAt(0).commonAncestorContainer)) savedRange = selection.getRangeAt(0).cloneRange();
  };
  input.addEventListener('keyup', rememberSelection);
  input.addEventListener('mouseup', rememberSelection);
  input.addEventListener('focusout', rememberSelection);
  toolbar.addEventListener('pointerdown', rememberSelection);
  const applyColor = (command, value) => {
    if (input.contentEditable !== 'true') return;
    input.focus();
    if (savedRange) { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(savedRange); }
    document.execCommand(command, false, value);
    rememberSelection();
  };
  for (const [command, title, text] of [['bold', 'Bold', 'B'], ['underline', 'Underline', 'U']]) {
    const control = button(text, () => { input.focus(); document.execCommand(command); });
    control.className = `note-format-${command}`; control.title = `${title} (Ctrl+${text})`; control.setAttribute('aria-label', title);
    control.addEventListener('mousedown', event => event.preventDefault()); toolbar.append(control);
  }
  for (const [command, title, initial] of [['foreColor', 'Text color', '#233731'], ['hiliteColor', 'Highlight', '#fff59d']]) {
    const label = element('label', 'note-color-control'), picker = element('input');
    label.append(document.createTextNode(title));
    picker.type = 'color'; picker.value = initial; picker.title = title; picker.setAttribute('aria-label', title);
    picker.addEventListener('input', () => applyColor(command, picker.value));
    label.append(picker); toolbar.append(label);
  }
  const clearHighlight = button('Clear highlight', () => applyColor('hiliteColor', 'transparent'));
  clearHighlight.addEventListener('mousedown', event => event.preventDefault());
  toolbar.append(clearHighlight);
  const resize = button('Expand editor', () => {
    const expanded = resize.getAttribute('aria-expanded') !== 'true';
    input.style.height = expanded ? '45dvh' : '';
    resize.textContent = expanded ? 'Reduce editor' : 'Expand editor';
    resize.setAttribute('aria-expanded', String(expanded));
  });
  resize.className = 'note-editor-resize';
  resize.setAttribute('aria-expanded', 'false');
  resize.title = 'Show more writing space. You can also drag the bottom-right corner.';
  toolbar.append(resize);
  input.addEventListener('paste', event => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? ''); });
  input.addEventListener('drop', event => event.preventDefault());
  node.append(toolbar, input);
  return { node, input, read() {
    let body = ''; const formatting = [];
    const append = (text, bold, underline, color = '', backgroundColor = '') => {
      const start = body.length; body += text;
      if (text && (bold || underline || color || backgroundColor)) formatting.push({ start, end: body.length, ...(bold ? { bold: true } : {}), ...(underline ? { underline: true } : {}), ...(color ? { color } : {}), ...(backgroundColor ? { backgroundColor } : {}) });
    };
    const walk = (node, bold = false, underline = false, color = '', backgroundColor = '') => {
      if (node.nodeType === Node.TEXT_NODE) { append(node.textContent ?? '', bold, underline, color, backgroundColor); return; }
      if (!(node instanceof HTMLElement)) return;
      const block = node !== input && ['DIV', 'P'].includes(node.tagName);
      if (block && body && !body.endsWith('\n')) append('\n', false, false);
      if (node.tagName === 'BR') { append('\n', false, false); return; }
      const weight = node.style.fontWeight;
      bold ||= ['B', 'STRONG'].includes(node.tagName) || weight === 'bold' || Number(weight) >= 600;
      underline ||= node.tagName === 'U' || node.style.textDecoration.includes('underline');
      color = noteColor(node.style.color || node.getAttribute('color')) || color;
      if (node.style.backgroundColor) backgroundColor = noteColor(node.style.backgroundColor);
      node.childNodes.forEach(child => walk(child, bold, underline, color, backgroundColor));
      if (block && !body.endsWith('\n')) append('\n', false, false);
    };
    walk(input);
    const trimStart = body.length - body.trimStart().length; body = body.trim();
    if (body.length > 10000) throw new Error('Notes can contain up to 10,000 characters.');
    return { body, formatting: formatting.map(span => ({ ...span, start: Math.max(0, span.start - trimStart), end: Math.min(body.length, span.end - trimStart) })).filter(span => span.end > span.start) };
  } };
}
