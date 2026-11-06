/* =====================================================================
   AGUA INMACULADA · FASE 2
   Reparto a empresas (camioneta), domicilio (moto), pedidos y préstamos
   ===================================================================== */

/* ---------------- firma en pantalla ---------------- */
function padFirma(id) {
  return `<div class="field"><label>Firma de recibido</label>
    <canvas id="${id}" style="width:100%;height:170px;border:2px dashed var(--line);border-radius:12px;background:#fff;touch-action:none;display:block"></canvas>
    <div class="row" style="margin-top:6px"><span class="mut small">Que firme con el dedo dentro del recuadro.</span><span class="sp"></span><button type="button" class="btn sm ghost" data-borrar="${id}">Borrar firma</button></div></div>`;
}
function activarFirma(id) {
  const c = document.getElementById(id);
  const r = c.getBoundingClientRect(), k = window.devicePixelRatio || 1;
  c.width = r.width * k; c.height = r.height * k;
  const g = c.getContext('2d'); g.scale(k, k); g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#10323D';
  let dib = false, vacio = true, last = null;
  const pos = e => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.onpointerdown = e => { dib = true; last = pos(e); c.setPointerCapture(e.pointerId); };
  c.onpointermove = e => { if (!dib) return; const p = pos(e); g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke(); last = p; vacio = false; };
  c.onpointerup = c.onpointercancel = () => { dib = false; };
  document.querySelector(`[data-borrar="${id}"]`).onclick = () => { g.clearRect(0, 0, c.width, c.height); vacio = true; };
  return {
    vacia: () => vacio,
    async subir(carpeta) {
      if (vacio) return null;
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      const path = `firmas/${carpeta}/${fechaMX()}/${S.session.user.id}-${Date.now()}.png`;
      const { error } = await sb.storage.from('evidencias').upload(path, blob, { contentType: 'image/png' });
      if (error) throw error;
      return path;
    }
  };
}
const linkMaps = (dom, url) => url || ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((dom || '') + ', Real del Valle, Tlajomulco, Jalisco'));


/* ---------------- avisos de pedidos nuevos ---------------- */
let _canalPedidos = null, _audio = null;
function sonarAviso() {
  try {
    _audio = _audio || new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach(t => { const o = _audio.createOscillator(), g = _audio.createGain(); o.frequency.value = 880; o.connect(g); g.connect(_audio.destination);
      g.gain.setValueAtTime(0.4, _audio.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, _audio.currentTime + t + 0.3); o.start(_audio.currentTime + t); o.stop(_audio.currentTime + t + 0.3); });
  } catch {}
  try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch {}
}
function escucharPedidos() {
  if (_canalPedidos) return;
  _canalPedidos = sb.channel('pedidos-nuevos')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, ev => {
      sonarAviso();
      const p = ev.new || {};
      toast(`Nuevo pedido: ${p.nombre || ''} · ${p.marcas ? Object.entries(p.marcas).map(([m, q]) => q + ' ' + m).join(', ') : (p.cantidad || '') + ' garrafones'}`, 'ok');
      if (S.modo === 'repartidor' && S.tab === 'r_pedidos') render();
    }).subscribe();
}
// Pide a Supabase que mande la notificación al teléfono de Javier (si falla, igual le llega en tiempo real)
function avisarPush(id) { try { sb.functions.invoke('aviso-pedido', { body: { id } }).catch(() => {}); } catch {} }
const b64aBytes = b => { const p = '='.repeat((4 - b.length % 4) % 4), r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };
async function suscripcionPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !CFG.VAPID_PUBLICA) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function pintarAvisos() {
  const box = document.getElementById('rp-avisos'); if (!box) return;
  if (!('PushManager' in window) || !('Notification' in window)) { box.innerHTML = '<div class="alert warn">Este teléfono no permite avisos con la pantalla bloqueada. Abre la app en Chrome.</div>'; return; }
  const sub = await suscripcionPush().catch(() => null);
  if (sub && Notification.permission === 'granted') { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="alert warn" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span>Activa los avisos para que te suene aunque el teléfono esté bloqueado.</span><span class="sp"></span><button class="btn sm" id="rp-act">Activar avisos</button></div>`;
  document.getElementById('rp-act').onclick = e => busy(e.currentTarget, async () => {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('No diste permiso de notificaciones. Actívalo en Ajustes de Chrome → Notificaciones.');
    const reg = await navigator.serviceWorker.ready;
    const s = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(CFG.VAPID_PUBLICA) });
    const j = s.toJSON();
    const { error } = await sb.rpc('guardar_push', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (error) throw error;
    sonarAviso(); toast('Avisos activados en este teléfono', 'ok'); pintarAvisos();
  });
}

/* =====================================================================
   REPARTIDOR
   ===================================================================== */
async function renderReparto() {
  await cargarTurno();
  if (!S.turno) return vistaAbrirReparto(shell(null));
  const t = S.turno.tipo;
  const tabs = t === 'camioneta'
    ? [['r_entregar', 'Entregar'], ['r_recargar', 'Cargar más'], ['r_cerrar', 'Cerrar turno']]
    : [['r_pedidos', 'Pedidos'], ['r_vuelta', 'Nueva vuelta'], ['r_cerrar', 'Cerrar turno']];
  if (!tabs.some(x => x[0] === S.tab)) S.tab = tabs[0][0];
  const main = shell(tabs);
  if (t === 'moto') escucharPedidos();
  return VISTAS_REPARTO[S.tab](main);
}

function vistaAbrirReparto(main) {
  const caja = cfg('caja_chica_moto') || 250;
  main.innerHTML = `
  <div class="card" style="max-width:600px;margin:0 auto">
    <h1>Abrir turno de reparto</h1>
    <p class="mut">Hora de entrada: <b>${fmtHora(new Date())}</b></p>
    <div class="pay" style="margin-bottom:16px"><button data-tipo="camioneta" class="on">Empresas<br><span class="small">camioneta</span></button><button data-tipo="moto">Domicilio<br><span class="small">moto</span></button></div>
    <div id="ar-cam">
      <div class="field"><label>Garrafones llenos que cargas en la camioneta</label><input type="number" id="ar-carga" inputmode="numeric" placeholder="ej. 56"></div>
    </div>
    <div id="ar-moto" class="hidden">
      <div class="field"><label>Caja chica para cambio</label><input type="number" id="ar-caja" inputmode="decimal" value="${caja}"></div>
      <label class="chk"><input type="checkbox" id="ar-ok" checked> Recibí la caja chica completa (${money(caja)})</label>
    </div>
    <div class="field"><label>Notas (opcional)</label><input type="text" id="ar-n"></div>
    <button class="btn big" id="ar-b">Abrir turno</button>
  </div>`;
  let tipo = 'camioneta';
  main.querySelectorAll('[data-tipo]').forEach(b => b.onclick = () => {
    tipo = b.dataset.tipo;
    main.querySelectorAll('[data-tipo]').forEach(x => x.classList.toggle('on', x === b));
    document.getElementById('ar-cam').classList.toggle('hidden', tipo !== 'camioneta');
    document.getElementById('ar-moto').classList.toggle('hidden', tipo !== 'moto');
  });
  document.getElementById('ar-b').onclick = e => busy(e.currentTarget, async () => {
    const carga = tipo === 'camioneta' ? nval('ar-carga') : 0;
    if (tipo === 'camioneta' && (!carga || carga <= 0)) throw new Error('Escribe cuántos garrafones cargas');
    if (tipo === 'moto' && !chk('ar-ok') && !val('ar-n')) throw new Error('Si la caja no está completa, explícalo en notas');
    const { error } = await sb.rpc('abrir_turno_reparto', { p_tipo: tipo, p_caja: tipo === 'moto' ? (nval('ar-caja') ?? 0) : 0, p_carga: carga, p_notas: val('ar-n') || null });
    if (error) throw error;
    toast('Turno abierto', 'ok'); S.tab = null; render();
  });
}

async function resumenCarga() {
  const [{ data: cg }, { data: en }, { data: pe }] = await Promise.all([
    sb.from('cargas').select('garrafones').eq('turno_id', S.turno.id),
    sb.from('entregas').select('llenos,vacios,nuevos').eq('turno_id', S.turno.id),
    sb.from('pedidos').select('entregado_cantidad').eq('turno_id', S.turno.id).eq('estado', 'entregado')
  ]);
  const cargados = (cg || []).reduce((s, x) => s + x.garrafones, 0);
  const entregados = S.turno.tipo === 'camioneta' ? (en || []).reduce((s, x) => s + x.llenos + num(x.nuevos), 0) : (pe || []).reduce((s, x) => s + num(x.entregado_cantidad), 0);
  const vacios = (en || []).reduce((s, x) => s + x.vacios, 0);
  return { cargados, entregados, vacios, quedan: cargados - entregados };
}
const barraCarga = r => `<div class="grid g3" style="margin-bottom:16px">
  <div class="kpi"><div class="l">Cargados</div><div class="v">${fmtN(r.cargados)}</div></div>
  <div class="kpi"><div class="l">Entregados</div><div class="v">${fmtN(r.entregados)}</div></div>
  <div class="kpi"><div class="l">Te quedan llenos</div><div class="v" style="color:${r.quedan < 0 ? 'var(--bad)' : 'var(--teal-d)'}">${fmtN(r.quedan)}</div>${S.turno.tipo === 'camioneta' ? `<div class="s">Vacíos recogidos: ${fmtN(r.vacios)}</div>` : ''}</div></div>`;

const VISTAS_REPARTO = {
  /* ---------- CAMIONETA: entregar a empresa ---------- */
  async r_entregar(main) {
    await cargarCatalogos();
    const empresas = S.clientes.filter(c => c.tipo === 'empresa' || c.tipo === 'restaurante').sort((a, b) => (a.zona || 'Z').localeCompare(b.zona || 'Z') || a.nombre.localeCompare(b.nombre));
    const r = await resumenCarga();
    const { data: hoy } = await sb.from('entregas').select('*').eq('turno_id', S.turno.id).order('fecha', { ascending: false });
    const dia = diaHoy(), hechos = new Set((hoy || []).map(e => e.cliente_id));
    const ruta = empresas.filter(c => (c.dias_entrega || []).includes(dia));
    const nomDia = DIAS_SEM.find(d => d[0] === dia)?.[1] || '';
    main.innerHTML = barraCarga(r) + `
    <div class="card" style="margin-bottom:16px"><div class="row"><h2 style="margin:0">Ruta de hoy · ${esc(nomDia)}</h2><span class="sp"></span><span class="tag inf">${ruta.filter(c => hechos.has(c.id)).length} de ${ruta.length} entregadas</span></div>
      ${ruta.length ? `<div class="tw"><table><tbody>${ruta.map(c => `<tr><td>${hechos.has(c.id) ? '<span class="tag ok">Entregado</span> ' : ''}<b>${esc(c.nombre)}</b>${c.zona ? ` <span class="mut small">Zona ${esc(c.zona)}</span>` : ''}
          <br><span class="mut small">Recibe: ${esc(c.quien_recibe || '—')} · ${esc(txtCredito(c))}${c.notas ? ' · ' + esc(c.notas) : ''}</span></td>
        <td style="white-space:nowrap"><a class="btn sm sec" href="${esc(linkMaps(c.domicilio || c.nombre, c.maps_url))}" target="_blank" rel="noopener">Maps</a>
          ${c.telefono ? `<a class="btn sm ghost" href="tel:${esc(c.telefono)}">Llamar</a>` : ''}
          ${hechos.has(c.id) ? '' : `<button class="btn sm ru-ent" data-id="${c.id}">Entregar</button>`}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">Hoy no hay empresas programadas. Puedes elegir cualquier empresa abajo.</div>'}
    </div>
    <div class="grid g2">
      <div class="card" id="re-card">
        <h2>Entrega a empresa</h2>
        <div class="field"><label>Empresa</label><select id="re-c"><option value="">— Elige la empresa —</option>${empresas.map(c => `<option value="${c.id}">${c.zona ? 'Zona ' + esc(c.zona) + ' · ' : ''}${esc(c.nombre)}</option>`).join('')}</select></div>
        <div id="re-info" class="mut small" style="margin:-6px 0 12px"></div>
        <div class="grid g2">
          <div class="field"><label>Garrafones llenos que entregas</label><input type="number" id="re-l" inputmode="numeric"></div>
          <div class="field"><label>Garrafones vacíos que recoges</label><input type="number" id="re-v" inputmode="numeric" value="0"></div>
        </div>
        <div class="field"><label>Garrafones nuevos que les vendes (envase con agua)</label><input type="number" id="re-g" inputmode="numeric" value="0">
          <span class="mut small">Se cobran a ${money(S.productos.find(p => p.nombre === 'Garrafón nuevo')?.precio)} c/u y el envase queda de la empresa.</span></div>
        <div class="field"><label>Nombre de quien recibe</label><input type="text" id="re-r"></div>
        <div id="re-pago"></div>
        ${padFirma('re-f')}
        <div class="field"><label>Notas</label><input type="text" id="re-n"></div>
        <button class="btn big" id="re-b">Guardar entrega</button>
        <p class="mut small">Si la empresa es de crédito, la entrega queda por cobrar. Si es de contado, cobra al entregar.</p>
      </div>
      <div class="card"><h2>Entregas de hoy</h2>
        <table><thead><tr><th>Empresa</th><th class="n">Llenos</th><th class="n">Vacíos</th><th></th></tr></thead><tbody>
        ${(hoy || []).map(e => `<tr><td><b>${esc(S.clientes.find(c => c.id === e.cliente_id)?.nombre || '')}</b><br><span class="mut small">${fmtHora(e.fecha)} · recibió ${esc(e.recibio || '')}</span></td><td class="n">${e.llenos}${num(e.nuevos) ? `<br><span class="mut small">+${e.nuevos} nuevos</span>` : ''}</td><td class="n">${e.vacios}</td><td><button class="btn sm sec" data-nota="${e.id}">Nota</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Aún no hay entregas</td></tr>'}
        </tbody></table></div>
    </div>`;
    const firma = activarFirma('re-f');
    main.querySelectorAll('[data-nota]').forEach(b => b.onclick = () => busy(b, () => mostrarNotaEntrega(Number(b.dataset.nota))));
    let fpEnt = null;
    const pintarPago = c => {
      const box = document.getElementById('re-pago');
      if (!c || c.dias_credito !== 0) { fpEnt = null; document.getElementById('re-l').oninput = null; document.getElementById('re-g').oninput = null; box.innerHTML = c ? `<div class="alert inf">${esc(txtCredito(c))}: no cobras, queda por cobrar.</div>` : ''; return; }
      fpEnt = c.forma_pago_habitual || 'efectivo';
      const pinta = () => {
        const l = nval('re-l') ?? 0, g = nval('re-g') ?? 0, pr = num(c.precio_especial ?? S.productos.find(p => p.nombre === 'Relleno garrafón')?.precio), pg = num(S.productos.find(p => p.nombre === 'Garrafón nuevo')?.precio);
        box.innerHTML = `<div class="field"><label>Contado · ¿cómo te pagó?</label><div class="pay"><button data-fp="efectivo" class="${fpEnt === 'efectivo' ? 'on' : ''}">Efectivo</button><button data-fp="transferencia" class="${fpEnt === 'transferencia' ? 'on' : ''}">Transferencia</button></div></div>
          <div class="total"><span>Cobrar</span><span>${money(l * pr + g * pg)}</span></div>`;
        box.querySelectorAll('[data-fp]').forEach(b => b.onclick = () => { fpEnt = b.dataset.fp; pinta(); });
      };
      pinta(); document.getElementById('re-l').oninput = pinta; document.getElementById('re-g').oninput = pinta;
    };
    const elegir = id => {
      const sel = document.getElementById('re-c'); sel.value = id; sel.onchange({ target: sel });
      const c = S.clientes.find(x => x.id == id);
      if (c?.quien_recibe && !val('re-r') && c.quien_recibe.toLowerCase() !== 'encargado') document.getElementById('re-r').value = c.quien_recibe;
      document.getElementById('re-card').scrollIntoView({ behavior: 'smooth' }); document.getElementById('re-l').focus();
    };
    main.querySelectorAll('.ru-ent').forEach(b => b.onclick = () => elegir(b.dataset.id));
    document.getElementById('re-c').onchange = e => {
      const c = S.clientes.find(x => x.id == e.target.value);
      pintarPago(c);
      document.getElementById('re-info').innerHTML = c ? `Precio: <b>${money(c.precio_especial ?? S.productos.find(p => p.nombre === 'Relleno garrafón')?.precio)}</b> por garrafón · Tiene <b>${fmtN(c.garrafones_prestados)}</b> garrafones nuestros${c.domicilio || c.maps_url ? ` · <a href="${esc(linkMaps(c.domicilio || c.nombre, c.maps_url))}" target="_blank" rel="noopener">Ver en Maps</a>` : ''}` : '';
    };
    document.getElementById('re-b').onclick = e => busy(e.currentTarget, async () => {
      const cli = val('re-c'); if (!cli) throw new Error('Elige la empresa');
      const l = nval('re-l') ?? 0, v = nval('re-v') ?? 0, g = nval('re-g') ?? 0;
      if (l <= 0 && v <= 0 && g <= 0) throw new Error('Escribe cuántos garrafones entregas o recoges');
      if (l + g > r.quedan && !(await confirmar(`Según tu carga solo te quedan ${r.quedan} llenos. ¿Guardar de todos modos?`, 'Guardar'))) return;
      if (!val('re-r')) throw new Error('Escribe el nombre de quien recibe');
      if (firma.vacia()) throw new Error('Falta la firma de recibido');
      const f = await firma.subir('entregas');
      const { data: eid, error } = await sb.rpc('registrar_entrega_empresa', { p_turno_id: S.turno.id, p_cliente_id: Number(cli), p_llenos: l, p_vacios: v, p_recibio: val('re-r'), p_firma: f, p_notas: val('re-n') || null, p_forma_pago: fpEnt, p_nuevos: g });
      if (error) throw error;
      toast('Entrega guardada', 'ok'); await VISTAS_REPARTO.r_entregar(main);
      mostrarNotaEntrega(eid).catch(err => toast('No se pudo armar la nota: ' + err.message, 'bad'));
    });
  },

  /* ---------- CAMIONETA: cargar más ---------- */
  async r_recargar(main) {
    const r = await resumenCarga();
    main.innerHTML = barraCarga(r) + `<div class="card" style="max-width:520px">
      <h2>Cargar más garrafones</h2><p class="mut">Úsalo si regresas a planta a recargar la camioneta.</p>
      <div class="field"><label>Garrafones llenos que cargas</label><input type="number" id="rc-q" inputmode="numeric"></div>
      <button class="btn big" id="rc-b">Registrar carga</button></div>`;
    document.getElementById('rc-b').onclick = e => busy(e.currentTarget, async () => {
      const q = nval('rc-q'); if (!q || q <= 0) throw new Error('Escribe la cantidad');
      const { error } = await sb.rpc('registrar_carga', { p_turno_id: S.turno.id, p_garrafones: q, p_notas: 'Recarga' });
      if (error) throw error; toast('Carga registrada', 'ok'); VISTAS_REPARTO.r_recargar(main);
    });
  },

  /* ---------- MOTO: pedidos ---------- */
  async r_pedidos(main) {
    const r = await resumenCarga();
    const { data: ps, error } = await sb.from('pedidos').select('*').eq('estado', 'pendiente').order('creado_en');
    if (error) throw error;
    const { data: hechos } = await sb.from('pedidos').select('*').eq('turno_id', S.turno.id).eq('estado', 'entregado').order('entregado_en', { ascending: false });
    const carga = {};
    (ps || []).forEach(p => { if (p.marcas) Object.entries(p.marcas).forEach(([m, q]) => carga[m] = (carga[m] || 0) + num(q)); else carga['Sin marca'] = (carga['Sin marca'] || 0) + num(p.cantidad); });
    const totPend = (ps || []).reduce((x, p) => x + num(p.cantidad), 0);
    main.innerHTML = barraCarga(r) + `<div id="rp-avisos"></div>
    <div class="card" style="padding:16px"><div class="row"><h2 style="margin:0">Llevar para los pendientes</h2><span class="sp"></span><span class="tag inf">${fmtN(totPend)} garrafones</span></div>
      <div style="font-size:18px;margin-top:8px">${Object.entries(carga).map(([m, q]) => `<b>${q}</b> ${esc(m)}`).join(' · ') || '<span class="mut">Nada pendiente</span>'}</div></div>
    <div class="row" style="margin-bottom:10px"><h2 style="margin:0">Pedidos pendientes (${(ps || []).length})</h2><span class="sp"></span><button class="btn sm sec" id="rp-ref">Actualizar</button></div>
    ${(ps || []).map(p => `<div class="card" style="padding:16px">
      <div class="row"><b style="font-size:18px">${esc(p.nombre)}</b>${p.origen === 'cliente' ? ' <span class="tag inf">Pidió en línea</span>' : ''}<span class="sp"></span><span class="tag ${p.forma_pago === 'efectivo' ? 'warn' : 'inf'}">${p.forma_pago === 'efectivo' ? 'Cobrar efectivo' : 'Transferencia'}</span></div>
      <div style="margin:6px 0;font-size:17px"><b>${esc(txtMarcas(p))}</b> · ${money(num(p.cantidad) * num(p.precio_unitario))}</div>
      <div>${esc(p.domicilio)}</div>
      <div class="mut small">${p.notas ? esc(p.notas) + ' · ' : ''}pedido ${fmtHora(p.creado_en)}</div>
      <div class="row" style="margin-top:12px">
        <a class="btn sm sec" href="${esc(linkMaps(p.domicilio, p.maps_url))}" target="_blank" rel="noopener">Maps</a>
        ${p.telefono ? `<a class="btn sm ghost" href="tel:${esc(p.telefono)}">Llamar</a><a class="btn sm ghost" href="https://wa.me/52${esc(soloDig(p.telefono).slice(-10))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        <span class="sp"></span><button class="btn sm ok" data-ent="${p.id}">Entregado</button></div></div>`).join('') || '<div class="card empty">No hay pedidos pendientes. Cuando llegue uno nuevo te va a sonar.</div>'}
    <div class="card"><h3>Entregados en este turno</h3><table><tbody>
      ${(hechos || []).map(p => `<tr><td>${fmtHora(p.entregado_en)} · ${esc(p.nombre)}<br><span class="mut small">${esc(txtMarcas(p))}</span></td><td>${esc(p.forma_pago_real)}</td><td class="n">${money(p.monto_cobrado)}</td></tr>`).join('') || '<tr><td class="empty">Aún no hay entregas</td></tr>'}
    </tbody></table></div>`;
    pintarAvisos();
    document.getElementById('rp-ref').onclick = () => VISTAS_REPARTO.r_pedidos(main);
    main.querySelectorAll('[data-ent]').forEach(b => b.onclick = () => {
      const p = ps.find(x => x.id == b.dataset.ent);
      modal(`<h2>Entregar a ${esc(p.nombre)}</h2><p><b>${esc(txtMarcas(p))}</b></p>
        <div class="field"><label>Garrafones entregados</label><input type="number" id="ep-q" value="${p.cantidad}" inputmode="numeric"></div>
        <div class="field"><label>¿Cómo pagó?</label><div class="pay"><button data-fp="efectivo" class="${p.forma_pago === 'efectivo' ? 'on' : ''}">Efectivo</button><button data-fp="transferencia" class="${p.forma_pago === 'transferencia' ? 'on' : ''}">Transferencia</button></div></div>
        <div class="total"><span>Cobrar</span><span id="ep-t">${money(p.cantidad * num(p.precio_unitario))}</span></div>
        <div class="row"><button class="btn ghost" data-close>Cancelar</button><span class="sp"></span><button class="btn ok" id="ep-b">Confirmar entrega</button></div>`,
        (box, close) => {
          let fp = p.forma_pago;
          box.querySelectorAll('[data-fp]').forEach(x => x.onclick = () => { fp = x.dataset.fp; box.querySelectorAll('[data-fp]').forEach(y => y.classList.toggle('on', y === x)); });
          box.querySelector('#ep-q').oninput = () => box.querySelector('#ep-t').textContent = money((nval('ep-q') || 0) * num(p.precio_unitario));
          box.querySelector('#ep-b').onclick = e => busy(e.currentTarget, async () => {
            const q = nval('ep-q'); if (!q || q <= 0) throw new Error('Escribe la cantidad');
            const { error } = await sb.rpc('entregar_pedido', { p_pedido_id: p.id, p_turno_id: S.turno.id, p_cantidad: q, p_forma_pago: fp });
            if (error) throw error; close(); toast('Entrega registrada', 'ok'); VISTAS_REPARTO.r_pedidos(main);
          });
        });
    });
  },

  /* ---------- MOTO: nueva vuelta ---------- */
  async r_vuelta(main) {
    const r = await resumenCarga();
    const precio = num(S.clientes.find(c => c.tipo === 'distribuidor')?.precio_especial) || 28;
    main.innerHTML = barraCarga(r) + `<div class="card" style="max-width:520px">
      <h2>Nueva vuelta</h2>
      <div class="field"><label>Garrafones llenos que te llevas</label><input type="number" id="rv-q" inputmode="numeric"></div>
      <div class="alert inf" id="rv-pagar">Págale a ventanilla ${money(precio)} por garrafón.</div>
      <button class="btn big" id="rv-b">Registrar vuelta</button></div>`;
    document.getElementById('rv-q').oninput = () => document.getElementById('rv-pagar').innerHTML = `Págale a ventanilla <b>${money((nval('rv-q') || 0) * precio)}</b> (${fmtN(nval('rv-q') || 0)} × ${money(precio)}). Ventanilla lo cobra eligiendo el cliente “Repartidor (domicilio)”.`;
    document.getElementById('rv-b').onclick = e => busy(e.currentTarget, async () => {
      const q = nval('rv-q'); if (!q || q <= 0) throw new Error('Escribe la cantidad');
      const { error } = await sb.rpc('registrar_carga', { p_turno_id: S.turno.id, p_garrafones: q, p_notas: 'Vuelta' });
      if (error) throw error; toast(`Vuelta registrada. Paga ${money(q * precio)} en ventanilla`, 'ok'); S.tab = 'r_pedidos'; renderReparto();
    });
  },

  /* ---------- CERRAR TURNO DE REPARTO ---------- */
  async r_cerrar(main) {
    const r = await resumenCarga();
    const cam = S.turno.tipo === 'camioneta';
    main.innerHTML = barraCarga(r) + `<div class="card" style="max-width:600px;margin:0 auto">
      <h1>Cerrar turno</h1>
      <div class="field"><label>Garrafones llenos que regresas</label><input type="number" id="rz-l" inputmode="numeric"></div>
      ${cam ? `<div class="field"><label>Garrafones vacíos que traes</label><input type="number" id="rz-v" inputmode="numeric"></div>
               <div class="field"><label>Efectivo que traes de empresas de contado (0 si ninguno)</label><input type="number" id="rz-e" inputmode="decimal" value="0"></div>`
            : `<div class="field"><label>Efectivo total que traes, contando la caja chica</label><input type="number" id="rz-e" inputmode="decimal"></div>`}
      <div class="field"><label>Notas</label><textarea id="rz-n"></textarea></div>
      <button class="btn big bad" id="rz-b">Cerrar turno</button></div>`;
    document.getElementById('rz-b').onclick = e => busy(e.currentTarget, async () => {
      const l = nval('rz-l'); if (l === null) throw new Error('Escribe los llenos que regresas (0 si ninguno)');
      const v = cam ? nval('rz-v') : 0; if (cam && v === null) throw new Error('Escribe los vacíos que traes');
      const ef = nval('rz-e'); if (ef === null) throw new Error('Escribe el efectivo que traes (0 si ninguno)');
      if (!(await confirmar('¿Cerrar el turno de reparto?', 'Sí, cerrar'))) return;
      const { data: x, error } = await sb.rpc('cerrar_turno_reparto', { p_turno_id: S.turno.id, p_regreso_llenos: l, p_regreso_vacios: v, p_efectivo_contado: ef, p_notas: val('rz-n') || null });
      if (error) throw error;
      S.turno = null; arqueoReparto(main, x);
    });
  }
};

function arqueoReparto(main, x) {
  const tc = cfg('tolerancia_caja') || 10;
  const al = (ok, txt) => `<div class="alert ${ok ? 'ok' : 'bad'}">${txt}</div>`;
  main.innerHTML = `<div class="card" style="max-width:600px;margin:0 auto">
    <h1>Turno cerrado</h1><p class="mut">Hora de salida: <b>${fmtHora(new Date())}</b></p>
    <h3>Garrafones</h3><table><tbody>
      <tr><td>Cargados</td><td class="n">${fmtN(x.cargados)}</td></tr>
      <tr><td>Entregados</td><td class="n">${fmtN(x.entregados)}</td></tr>
      <tr><td>Llenos que regresan</td><td class="n">${fmtN(x.regreso_llenos)}</td></tr></tbody></table>
    ${al(x.diferencia_llenos === 0, `Diferencia de llenos: ${x.diferencia_llenos > 0 ? '+' : ''}${x.diferencia_llenos}${x.diferencia_llenos === 0 ? ' · Cuadra' : x.diferencia_llenos < 0 ? ' · Faltan garrafones' : ' · Sobran garrafones'}`)}
    ${x.tipo === 'camioneta' ? `<table><tbody><tr><td>Vacíos recogidos en empresas</td><td class="n">${fmtN(x.vacios_recogidos)}</td></tr><tr><td>Vacíos que trae</td><td class="n">${fmtN(x.regreso_vacios)}</td></tr></tbody></table>
      ${al(x.diferencia_vacios === 0, `Diferencia de vacíos: ${x.diferencia_vacios}${x.diferencia_vacios === 0 ? ' · Cuadra' : ''}`)}
      <h3>Cobros de contado</h3><table><tbody>
        <tr><td>Cobrado en efectivo</td><td class="n">${money(x.cobrado_efectivo)}</td></tr>
        <tr><td>Cobrado por transferencia</td><td class="n">${money(x.cobrado_transferencia)}</td></tr>
        <tr><td><b>Efectivo que trae</b></td><td class="n"><b>${money(x.efectivo_contado)}</b></td></tr></tbody></table>
      ${al(Math.abs(num(x.diferencia_caja)) <= tc, `Diferencia de efectivo: ${money(x.diferencia_caja)}${num(x.diferencia_caja) === 0 ? ' · Cuadra' : num(x.diferencia_caja) < 0 ? ' · Falta dinero' : ' · Sobra dinero'}`)}` : `
    <h3>Dinero</h3><table><tbody>
      <tr><td>Caja chica inicial</td><td class="n">${money(x.caja_inicial)}</td></tr>
      <tr><td>Cobrado en efectivo</td><td class="n">${money(x.cobrado_efectivo)}</td></tr>
      <tr><td>Pagado a ventanilla</td><td class="n">-${money(x.pagado_ventanilla)}</td></tr>
      <tr><td><b>Efectivo esperado</b></td><td class="n"><b>${money(x.efectivo_esperado)}</b></td></tr>
      <tr><td><b>Efectivo que trae</b></td><td class="n"><b>${money(x.efectivo_contado)}</b></td></tr>
      <tr><td>Cobrado por transferencia</td><td class="n">${money(x.cobrado_transferencia)}</td></tr></tbody></table>
    ${al(Math.abs(num(x.diferencia_caja)) <= tc, `Diferencia de caja: ${money(x.diferencia_caja)}${num(x.diferencia_caja) === 0 ? ' · Cuadra' : Math.abs(num(x.diferencia_caja)) <= tc ? ' · Dentro de la tolerancia' : num(x.diferencia_caja) < 0 ? ' · Falta dinero' : ' · Sobra dinero'}`)}
    ${x.pedidos_pendientes ? `<div class="alert warn">Quedan ${x.pedidos_pendientes} pedidos sin entregar.</div>` : ''}`}
    <button class="btn big" onclick="S.tab=null;boot()">Listo</button></div>`;
}

/* =====================================================================
   PEDIDOS (captura) — dueños y ventanilla
   ===================================================================== */
const MARCAS = ['Ciel', 'Epura', 'Bluerock', 'Bonafont', 'Rositas'];
const txtMarcas = p => p.marcas && Object.keys(p.marcas).length
  ? Object.entries(p.marcas).map(([m, q]) => `${q} ${m}`).join(' · ')
  : `${fmtN(p.cantidad)} ${S.productos.find(x => x.id === p.producto_id)?.nombre || 'garrafones'}`;
const soloDig = t => String(t || '').replace(/\D/g, '');

async function vistaPedidos(main) {
  await cargarCatalogos();
  const hoy = fechaMX();
  const { data: ps, error } = await sb.from('pedidos').select('*').or(`estado.eq.pendiente,creado_en.gte.${inicioMX(hoy)}`).order('creado_en', { ascending: false }).limit(200);
  if (error) throw error;
  const domis = S.clientes.filter(c => c.tipo === 'domicilio');
  const rel = S.productos.find(p => p.nombre === 'Relleno garrafón');
  const precio = num(rel?.precio_domicilio ?? rel?.precio);
  const tag = e => e === 'pendiente' ? '<span class="tag warn">Pendiente</span>' : e === 'entregado' ? '<span class="tag ok">Entregado</span>' : '<span class="tag bad">Cancelado</span>';
  const pend = (ps || []).filter(p => p.estado === 'pendiente');
  const ent = (ps || []).filter(p => p.estado === 'entregado');
  main.innerHTML = `
  <div class="grid g4" style="margin-bottom:16px">
    <div class="kpi"><div class="l">Pendientes</div><div class="v">${pend.length}</div><div class="s">${fmtN(pend.reduce((s, p) => s + num(p.cantidad), 0))} garrafones</div></div>
    <div class="kpi"><div class="l">Entregados hoy</div><div class="v">${ent.length}</div><div class="s">${fmtN(ent.reduce((s, p) => s + num(p.entregado_cantidad), 0))} garrafones</div></div>
    <div class="kpi"><div class="l">Cobrado efectivo</div><div class="v">${money0(ent.filter(p => p.forma_pago_real === 'efectivo').reduce((s, p) => s + num(p.monto_cobrado), 0))}</div></div>
    <div class="kpi"><div class="l">Cobrado transferencia</div><div class="v">${money0(ent.filter(p => p.forma_pago_real === 'transferencia').reduce((s, p) => s + num(p.monto_cobrado), 0))}</div></div>
  </div>
  <div class="grid g2">
    <div class="card">
      <h2>Nuevo pedido</h2>
      <div class="field"><label>Buscar cliente: teléfono, nombre o calle</label><input type="search" id="pd-bus" placeholder="ej. 3312 o Pérez o Cerezo" autocomplete="off"></div>
      <div id="pd-res"></div>
      <div id="pd-ult"></div>
      <div class="field"><label>Garrafones por marca</label>
        <div id="pd-marcas">${MARCAS.map(m => `<div class="cart-line"><span class="n">${m}</span><button class="qb" data-mm="${m}">−</button><b id="pd-q-${m}" style="min-width:28px;text-align:center">0</b><button class="qb" data-mp="${m}">+</button></div>`).join('')}</div></div>
      <div class="total"><span id="pd-tq">0 garrafones</span><span id="pd-tt">$0.00</span></div>
      <div class="grid g2">
        <div class="field"><label>Nombre</label><input type="text" id="pd-n"></div>
        <div class="field"><label>Teléfono</label><input type="tel" id="pd-t" inputmode="tel"></div>
      </div>
      <div class="field"><label>Domicilio</label><input type="text" id="pd-d" placeholder="Calle, número, coto"></div>
      <div class="field"><label>Liga de Google Maps (opcional)</label><input type="text" id="pd-m"></div>
      <div class="field"><label>Pagará con</label><div class="pay" id="pd-fp"><button data-fp="efectivo" class="on">Efectivo</button><button data-fp="transferencia">Transferencia</button></div></div>
      <div class="field"><label>Notas para Javier</label><input type="text" id="pd-no" placeholder="ej. Tocar el timbre, dejar con el guardia"></div>
      <button class="btn big" id="pd-b">Enviar pedido a Javier</button>
      <p class="mut small">El cliente se guarda solo con su teléfono. La próxima vez lo encuentras en el buscador con su último pedido.</p>
    </div>
    <div class="card"><h2>Pedidos de hoy</h2><div class="tw"><table><thead><tr><th>Cliente</th><th>Pedido</th><th>Estado</th><th></th></tr></thead><tbody>
      ${(ps || []).map(p => `<tr><td><b>${esc(p.nombre)}</b><br><span class="mut small">${esc(p.domicilio)}</span></td>
        <td>${esc(txtMarcas(p))}<br><span class="mut small">${fmtHora(p.creado_en)} · ${esc(p.forma_pago)}${p.origen === 'cliente' ? ' · <b>pidió en línea</b>' : ''}</span>${p.notas ? `<br><span class="mut small">${esc(p.notas)}</span>` : ''}</td>
        <td>${tag(p.estado)}${p.estado === 'entregado' ? `<br><span class="mut small">${fmtHora(p.entregado_en)} · ${money(p.monto_cobrado)} ${esc(p.forma_pago_real)}</span>` : ''}</td>
        <td>${p.revisar ? `<span class="tag bad">Revisar</span><br><button class="btn sm" data-rev="${p.id}" style="margin:4px 0">${p.cliente_id ? 'Revisado' : 'Guardar cliente'}</button><br>` : ''}${p.estado === 'pendiente' ? `<button class="btn sm ghost" data-can="${p.id}">Cancelar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sin pedidos hoy</td></tr>'}
    </tbody></table></div>
    <div class="alert inf" style="margin-top:12px">Liga para que tus clientes pidan solos:<br><b id="pd-liga">${esc(new URL('pedir.html', location.href).href)}</b>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="pd-copiar">Copiar liga</button></div></div></div>
  </div>`;
  const q = Object.fromEntries(MARCAS.map(m => [m, 0]));
  let cli = null, fp = 'efectivo';
  const pintaQ = () => {
    MARCAS.forEach(m => document.getElementById('pd-q-' + m).textContent = q[m]);
    const t = MARCAS.reduce((x, m) => x + q[m], 0);
    document.getElementById('pd-tq').textContent = `${t} ${t === 1 ? 'garrafón' : 'garrafones'}`;
    document.getElementById('pd-tt').textContent = money(t * precio);
  };
  main.querySelectorAll('[data-mp]').forEach(b => b.onclick = () => { q[b.dataset.mp]++; pintaQ(); });
  main.querySelectorAll('[data-mm]').forEach(b => b.onclick = () => { q[b.dataset.mm] = Math.max(0, q[b.dataset.mm] - 1); pintaQ(); });
  main.querySelectorAll('#pd-fp [data-fp]').forEach(b => b.onclick = () => { fp = b.dataset.fp; main.querySelectorAll('#pd-fp [data-fp]').forEach(x => x.classList.toggle('on', x === b)); });
  const elegir = async c => {
    cli = c;
    document.getElementById('pd-res').innerHTML = '';
    document.getElementById('pd-bus').value = c.nombre;
    document.getElementById('pd-n').value = c.nombre || ''; document.getElementById('pd-t').value = c.telefono || '';
    document.getElementById('pd-d').value = c.domicilio || ''; document.getElementById('pd-m').value = c.maps_url || '';
    const { data: u } = await sb.from('pedidos').select('marcas,cantidad,producto_id,forma_pago,creado_en,notas').eq('cliente_id', c.id).neq('estado', 'cancelado').order('creado_en', { ascending: false }).limit(1);
    const ul = u && u[0];
    MARCAS.forEach(m => q[m] = 0);
    if (ul?.marcas) Object.entries(ul.marcas).forEach(([m, n]) => { if (m in q) q[m] = num(n); });
    if (ul?.forma_pago) main.querySelector(`#pd-fp [data-fp="${ul.forma_pago}"]`)?.click();
    document.getElementById('pd-ult').innerHTML = ul ? `<div class="alert inf">Último pedido (${fmtFecha(ul.creado_en)}): <b>${esc(txtMarcas(ul))}</b>. Ya quedó cargado; ajusta si cambia.</div>` : '<div class="alert inf">Primer pedido de este cliente.</div>';
    pintaQ();
  };
  document.getElementById('pd-bus').oninput = e => {
    const t = e.target.value.trim().toLowerCase(), d = soloDig(t);
    cli = null;
    const res = t.length < 2 ? [] : domis.filter(c => (d.length >= 3 && soloDig(c.telefono).includes(d)) || (c.nombre || '').toLowerCase().includes(t) || (c.domicilio || '').toLowerCase().includes(t)).slice(0, 8);
    document.getElementById('pd-res').innerHTML = res.map(c => `<button class="btn ghost" style="display:block;width:100%;text-align:left;margin-bottom:6px" data-cl="${c.id}"><b>${esc(c.nombre)}</b> <span class="mut small">${esc(c.telefono || '')} · ${esc(c.domicilio || '')}</span></button>`).join('')
      + (t.length >= 2 && !res.length ? '<div class="mut small" style="margin-bottom:10px">No está registrado: llena sus datos abajo y se guarda solo.</div>' : '');
    document.querySelectorAll('[data-cl]').forEach(b => b.onclick = () => elegir(domis.find(c => c.id == b.dataset.cl)));
    if (d.length >= 7 && !res.length) document.getElementById('pd-t').value = e.target.value.trim();
  };
  document.getElementById('pd-b').onclick = e => busy(e.currentTarget, async () => {
    const tot = MARCAS.reduce((x, m) => x + q[m], 0);
    if (!tot) throw new Error('Agrega al menos un garrafón');
    if (!val('pd-d')) throw new Error('Escribe el domicilio');
    if (!cli && !val('pd-t')) throw new Error('Escribe el teléfono para guardar al cliente');
    const marcas = Object.fromEntries(MARCAS.filter(m => q[m] > 0).map(m => [m, q[m]]));
    const { data: pid, error } = await sb.rpc('crear_pedido', { p_nombre: val('pd-n'), p_telefono: val('pd-t') || null, p_domicilio: val('pd-d'), p_maps: val('pd-m') || null,
      p_producto_id: rel?.id || null, p_cantidad: tot, p_forma_pago: fp, p_notas: val('pd-no') || null, p_cliente_id: cli?.id || null, p_marcas: marcas });
    if (error) throw error;
    avisarPush(pid);
    toast('Pedido enviado a Javier', 'ok'); await vistaPedidos(main); document.getElementById('pd-bus')?.focus();
  });
  main.querySelectorAll('[data-can]').forEach(b => b.onclick = () => modal(`<h2>Cancelar pedido</h2><div class="field"><label>Motivo</label><input type="text" id="cp-m"></div>
    <div class="row"><button class="btn ghost" data-close>Regresar</button><span class="sp"></span><button class="btn bad" id="cp-b">Cancelar pedido</button></div>`,
    (box, close) => box.querySelector('#cp-b').onclick = ev => busy(ev.currentTarget, async () => {
      const { error } = await sb.rpc('cancelar_pedido', { p_pedido_id: Number(b.dataset.can), p_motivo: val('cp-m') || 'Sin motivo' });
      if (error) throw error; close(); toast('Pedido cancelado', 'ok'); vistaPedidos(main);
    })));
  document.getElementById('pd-copiar').onclick = async () => {
    const t = `Haz tu pedido de garrafones aquí 👉 ${document.getElementById('pd-liga').textContent}`;
    try { await navigator.clipboard.writeText(t); toast('Liga copiada: pégala en tu respuesta automática de WhatsApp', 'ok'); } catch { toast('Selecciona la liga y cópiala a mano', 'bad'); }
  };
  main.querySelectorAll('[data-rev]').forEach(b => b.onclick = () => {
    const p = ps.find(x => x.id == b.dataset.rev);
    const com = String(p.notas || '').replace(/^CLIENTE NUEVO · /, '');
    if (p.cliente_id) return busy(b, async () => { const { error } = await sb.rpc('revisar_pedido', { p_pedido_id: p.id }); if (error) throw error; toast('Marcado como revisado', 'ok'); vistaPedidos(main); });
    modal(`<h2>Guardar cliente nuevo</h2><p class="mut">Pidió en línea con el teléfono <b>${esc(p.telefono || '')}</b>. Escríbelo como ustedes lo identifican.</p>
      ${com ? `<div class="alert warn">Comentario: ${esc(com)}</div>` : ''}
      <div class="field"><label>Nombre (como lo identifican)</label><input type="text" id="rv-n" value="${esc(p.nombre === 'Cliente nuevo' ? '' : p.nombre)}"></div>
      <div class="field"><label>Domicilio</label><input type="text" id="rv-d" value="${esc(p.domicilio)}"></div>
      <div class="row"><button class="btn ghost" data-close>Cancelar</button><span class="sp"></span><button class="btn" id="rv-b">Guardar cliente</button></div>`,
      (box, close) => box.querySelector('#rv-b').onclick = e => busy(e.currentTarget, async () => {
        if (!val('rv-d')) throw new Error('Escribe el domicilio');
        const { error } = await sb.rpc('revisar_pedido', { p_pedido_id: p.id, p_guardar_cliente: true, p_nombre: val('rv-n') || null, p_domicilio: val('rv-d') });
        if (error) throw error; close(); toast('Cliente guardado', 'ok'); vistaPedidos(main);
      }));
  });
  pintaQ(); document.getElementById('pd-bus').focus();
}

/* =====================================================================
   PRÉSTAMOS DE GARRAFONES (con firma)
   ===================================================================== */
async function vistaPrestamos(main) {
  await cargarCatalogos();
  const { data: ps, error } = await sb.from('prestamos').select('*').order('fecha', { ascending: false }).limit(500);
  if (error) throw error;
  // saldo por persona
  const saldo = {};
  for (const p of [...(ps || [])].reverse()) {
    const k = p.cliente_id ? 'c' + p.cliente_id : 'n' + p.nombre.trim().toLowerCase();
    const s = saldo[k] = saldo[k] || { nombre: p.nombre, telefono: p.telefono, domicilio: p.domicilio, cliente_id: p.cliente_id, cantidad: 0, desde: p.fecha, ultimo: p.fecha };
    s.cantidad += p.tipo === 'prestamo' ? p.cantidad : -p.cantidad; s.ultimo = p.fecha;
    if (s.cantidad <= 0) s.desde = null; else if (!s.desde) s.desde = p.fecha;
  }
  const deudores = Object.values(saldo).filter(s => s.cantidad > 0 && !s.cliente_id);
  const empresas = S.clientes.filter(c => num(c.garrafones_prestados) > 0);
  const dias = d => Math.floor((Date.now() - new Date(d)) / 864e5);
  const valor = 150;
  const totalPrest = deudores.reduce((s, d) => s + d.cantidad, 0) + empresas.reduce((s, c) => s + num(c.garrafones_prestados), 0);
  main.innerHTML = `
  <div class="grid g3" style="margin-bottom:16px">
    <div class="kpi"><div class="l">Garrafones fuera de planta</div><div class="v">${fmtN(totalPrest)}</div><div class="s">Valor aprox. ${money0(totalPrest * valor)}</div></div>
    <div class="kpi"><div class="l">En empresas y restaurantes</div><div class="v">${fmtN(empresas.reduce((s, c) => s + num(c.garrafones_prestados), 0))}</div></div>
    <div class="kpi"><div class="l">Prestados a particulares</div><div class="v">${fmtN(deudores.reduce((s, d) => s + d.cantidad, 0))}</div></div>
  </div>
  <div class="grid g2">
    <div class="card">
      <h2>Registrar préstamo o devolución</h2>
      <div class="pay" style="margin-bottom:14px"><button data-tp="prestamo" class="on">Préstamo</button><button data-tp="devolucion">Devolución</button></div>
      <div class="field"><label>Cliente registrado (opcional)</label><select id="pr-c"><option value="">— Particular —</option>${S.clientes.filter(c => c.tipo !== 'distribuidor').map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</select></div>
      <div id="pr-part">
        <div class="field"><label>Nombre de quien firma</label><input type="text" id="pr-n" list="pr-lista"><datalist id="pr-lista">${deudores.map(d => `<option value="${esc(d.nombre)}">`).join('')}</datalist></div>
        <div class="grid g2"><div class="field"><label>Teléfono</label><input type="tel" id="pr-t"></div><div class="field"><label>Domicilio</label><input type="text" id="pr-d"></div></div>
      </div>
      <div class="field"><label>Cantidad de garrafones</label><input type="number" id="pr-q" value="1" inputmode="numeric"></div>
      ${padFirma('pr-f')}
      <div class="field"><label>Notas</label><input type="text" id="pr-no"></div>
      <button class="btn big" id="pr-b">Guardar y firmar</button>
      <p class="mut small">El garrafón se presta sin depósito. El ticket impreso dice que el cliente se compromete a devolverlo.</p>
    </div>
    <div>
      <div class="card"><h2>Quién tiene garrafones</h2><div class="tw"><table><thead><tr><th>Nombre</th><th class="n">Garrafones</th><th>Desde</th></tr></thead><tbody>
        ${empresas.map(c => `<tr><td><b>${esc(c.nombre)}</b><br><span class="mut small">${esc(c.tipo)}</span></td><td class="n">${fmtN(c.garrafones_prestados)}</td><td>—</td></tr>`).join('')}
        ${deudores.sort((a, b) => new Date(a.desde) - new Date(b.desde)).map(d => `<tr><td><b>${esc(d.nombre)}</b><br><span class="mut small">${esc(d.telefono || '')} ${esc(d.domicilio || '')}</span></td><td class="n">${fmtN(d.cantidad)}</td><td>${dias(d.desde) > 30 ? `<span class="tag bad">${dias(d.desde)} días</span>` : dias(d.desde) + ' días'}</td></tr>`).join('')}
        ${!empresas.length && !deudores.length ? '<tr><td colspan="3" class="empty">Nadie tiene garrafones prestados</td></tr>' : ''}
      </tbody></table></div></div>
      <div class="card"><h2>Últimos movimientos</h2><div class="tw"><table><tbody>
        ${(ps || []).slice(0, 25).map(p => `<tr><td>${fmtFecha(p.fecha)}</td><td><b>${esc(p.nombre)}</b></td><td>${p.tipo === 'prestamo' ? '<span class="tag warn">Préstamo</span>' : '<span class="tag ok">Devolución</span>'}</td><td class="n">${p.cantidad}</td>
          <td class="row" style="flex-wrap:nowrap">${p.firma ? `<button class="btn sm sec" data-foto="${esc(p.firma)}">Firma</button>` : ''}<button class="btn sm ghost" data-tk="${p.id}">Ticket</button></td></tr>`).join('') || '<tr><td class="empty">Sin movimientos</td></tr>'}
      </tbody></table></div></div>
    </div>
  </div>`;
  let tipo = 'prestamo';
  const firma = activarFirma('pr-f');
  main.querySelectorAll('[data-tp]').forEach(b => b.onclick = () => { tipo = b.dataset.tp; main.querySelectorAll('[data-tp]').forEach(x => x.classList.toggle('on', x === b)); });
  document.getElementById('pr-c').onchange = e => document.getElementById('pr-part').classList.toggle('hidden', !!e.target.value);
  document.getElementById('pr-n').onchange = e => { const d = deudores.find(x => x.nombre.toLowerCase() === e.target.value.trim().toLowerCase()); if (d) { document.getElementById('pr-t').value = d.telefono || ''; document.getElementById('pr-d').value = d.domicilio || ''; } };
  main.querySelectorAll('[data-foto]').forEach(b => b.onclick = () => verFoto(b.dataset.foto));
  main.querySelectorAll('[data-tk]').forEach(b => b.onclick = () => ticketPrestamo(ps.find(p => p.id == b.dataset.tk)));
  document.getElementById('pr-b').onclick = e => busy(e.currentTarget, async () => {
    const cli = val('pr-c') ? Number(val('pr-c')) : null;
    const q = nval('pr-q'); if (!q || q <= 0) throw new Error('Escribe la cantidad');
    if (!cli && !val('pr-n')) throw new Error('Escribe el nombre de quien firma');
    if (firma.vacia()) throw new Error('Falta la firma');
    const f = await firma.subir('prestamos');
    const { data: id, error } = await sb.rpc('registrar_prestamo', { p_tipo: tipo, p_cliente_id: cli, p_nombre: val('pr-n') || null, p_telefono: val('pr-t') || null,
      p_domicilio: val('pr-d') || null, p_cantidad: q, p_firma: f, p_notas: val('pr-no') || null });
    if (error) throw error;
    toast(tipo === 'prestamo' ? 'Préstamo registrado' : 'Devolución registrada', 'ok');
    const { data: p } = await sb.from('prestamos').select('*').eq('id', id).single();
    await vistaPrestamos(main);
    if (p) ticketPrestamo(p, true);
  });
}

function lineasPrestamo(p) {
  const W = cfg('ticket_ancho') || 32;
  const centro = s => { s = sinAcentos(s).slice(0, W); return ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s; };
  const sep = '-'.repeat(W);
  const partir = s => { const out = []; let l = ''; for (const w of sinAcentos(s).split(' ')) { if ((l + ' ' + w).trim().length > W) { out.push(l.trim()); l = w; } else l += ' ' + w; } if (l.trim()) out.push(l.trim()); return out; };
  const L = [{ t: centro('Real del Valle'), b: true }, { t: sep },
    { t: centro(p.tipo === 'prestamo' ? 'PRESTAMO DE GARRAFON' : 'DEVOLUCION DE GARRAFON'), b: true, big: true }, { t: sep },
    { t: 'Folio: P-' + p.id }, { t: 'Fecha: ' + new Date(p.fecha).toLocaleString('es-MX', { timeZone: CFG.ZONA, dateStyle: 'short', timeStyle: 'short' }).replace(/[^\x20-\x7E]/g, ' ') },
    { t: 'Nombre: ' + sinAcentos(p.nombre).slice(0, W - 8) }];
  if (p.telefono) L.push({ t: 'Tel: ' + sinAcentos(p.telefono) });
  if (p.domicilio) partir('Domicilio: ' + p.domicilio).forEach(t => L.push({ t }));
  L.push({ t: sep }, { t: 'Garrafones: ' + p.cantidad, b: true, big: true });
  if (p.tipo === 'prestamo') {
    L.push({ t: sep });
    partir(`Recibo en prestamo ${p.cantidad} garrafon(es) de 20 L propiedad de Agua Inmaculada, sin deposito. Me comprometo a devolverlos en buen estado. En caso de perdida o dano pagare $150.00 por cada uno.`).forEach(t => L.push({ t }));
  }
  L.push({ t: '' }, { t: '' }, { t: '' }, { t: '_'.repeat(W) }, { t: centro('Firma de ' + (p.tipo === 'prestamo' ? 'recibido' : 'quien entrega')) }, { t: centro('(firma digital registrada en sistema)') });
  return L;
}
async function ticketPrestamo(p, nuevo) {
  const L = lineasPrestamo(p);
  const logo = await logoRaster().catch(() => null);
  let firmaUrl = null;
  if (p.firma) { const { data } = await sb.storage.from('evidencias').createSignedUrl(p.firma, 600); firmaUrl = data?.signedUrl; }
  modal(`<h2>${p.tipo === 'prestamo' ? 'Préstamo' : 'Devolución'} P-${p.id}</h2>
    <pre style="background:#fff;border:1px dashed var(--line);border-radius:10px;padding:14px;font:14px/1.45 ui-monospace,Menlo,Consolas,monospace;overflow-x:auto;max-width:360px;margin:0 auto"><img src="logo.jpg" alt="" style="display:block;width:80%;margin:0 auto 6px;filter:grayscale(1) contrast(1.4)">${L.map(l => l.b ? `<b>${esc(l.t)}</b>` : esc(l.t)).join('\n')}${firmaUrl ? `\n<img src="${esc(firmaUrl)}" alt="Firma" style="display:block;width:70%;margin:6px auto 0">` : ''}</pre>
    <div class="row" style="margin-top:14px"><button class="btn ghost" data-close>Cerrar</button><span class="sp"></span><button class="btn" id="tp-p">Imprimir para firmar en papel</button></div>
    <p class="mut small">La firma digital ya quedó guardada. Si además quieres la firma en papel, imprime el ticket y guárdalo firmado.</p>`,
    (box, close) => box.querySelector('#tp-p').onclick = () => { enviarImpresora(escpos(L, false, logo)); close(); });
}

/* =====================================================================
   NOTA DE ENTREGA DIGITAL (empresas) Y ESTADO DE CUENTA MENSUAL
   ===================================================================== */
const folioE = id => 'E-' + String(id).padStart(5, '0');
const cargarImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
async function urlFirma(path) {
  if (!path) return null;
  try { const { data, error } = await sb.storage.from('evidencias').download(path); return error || !data ? null : URL.createObjectURL(data); } catch { return null; }
}
async function datosEntrega(id) {
  const { data: e, error } = await sb.from('entregas').select('*').eq('id', id).single();
  if (error) throw error;
  const [{ data: v }, { data: c }] = await Promise.all([
    e.venta_id ? sb.from('ventas').select('id,total,forma_pago,cancelada,venta_detalle(cantidad,producto_id,precio_unitario)').eq('id', e.venta_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('clientes').select('*').eq('id', e.cliente_id).maybeSingle()]);
  return { e, v, c: c || S.clientes.find(x => x.id === e.cliente_id) || {} };
}
const txtCondicion = (v, c) => !v ? '—' : v.forma_pago === 'credito' ? (c.dias_credito ? `Crédito ${c.dias_credito} días` : 'Crédito') : 'Contado · ' + (v.forma_pago === 'transferencia' ? 'Transferencia' : 'Efectivo');

async function canvasNota({ e, v, c }) {
  const W = 720, P = 44;
  const [logo, firma] = await Promise.all([cargarImg('logo.jpg'), urlFirma(e.firma).then(u => u ? cargarImg(u) : null)]);
  const det = v?.venta_detalle || [];
  const idRel = S.productos.find(p => p.nombre === 'Relleno garrafón')?.id, idNue = S.productos.find(p => p.nombre === 'Garrafón nuevo')?.id;
  const pu = pid => num(det.find(d => d.producto_id === pid)?.precio_unitario);
  const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = 2200;
  const g = tmp.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, tmp.height); g.fillStyle = '#10323D'; g.textBaseline = 'alphabetic';
  const F = (px, b) => g.font = `${b ? 'bold ' : ''}${px}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  let y = P;
  const txt = (t, x, al = 'left') => { g.textAlign = al; g.fillText(t, x, y); };
  const linea = () => { y += 18; g.fillStyle = '#C9D6DA'; g.fillRect(P, y, W - 2 * P, 2); g.fillStyle = '#10323D'; y += 22; };
  const par = (a, b, bold) => { F(26, bold); txt(a, P); txt(b, W - P, 'right'); y += 40; };
  if (logo) { const lw = 320, lh = logo.height * lw / logo.width; g.drawImage(logo, (W - lw) / 2, y, lw, lh); y += lh + 14; }
  y += 30; F(24); txt('Real del Valle', W / 2, 'center'); y += 52;
  F(36, true); txt('NOTA DE ENTREGA', W / 2, 'center'); y += 44;
  F(24); txt(`Folio ${folioE(e.id)}  ·  ${new Date(e.fecha).toLocaleString('es-MX', { timeZone: CFG.ZONA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, W / 2, 'center'); y += 10;
  linea(); y += 10;
  F(22); g.fillStyle = '#5B7680'; txt('CLIENTE', P); y += 36; g.fillStyle = '#10323D';
  F(32, true); txt(c.nombre || '', P); y += 30;
  linea(); y += 14;
  if (num(e.llenos)) par(`Garrafones llenos  ${e.llenos}${pu(idRel) ? ' × ' + money(pu(idRel)) : ''}`, pu(idRel) ? money(e.llenos * pu(idRel)) : '');
  if (num(e.nuevos)) par(`Garrafones nuevos  ${e.nuevos}${pu(idNue) ? ' × ' + money(pu(idNue)) : ''}`, pu(idNue) ? money(e.nuevos * pu(idNue)) : '');
  par('Vacíos recogidos', String(e.vacios || 0));
  if (v && !v.cancelada) { y += 6; F(34, true); txt('TOTAL', P); txt(money(v.total), W - P, 'right'); y += 44; }
  F(24); txt(txtCondicion(v, c), P); y += 10;
  if (e.notas) { y += 30; F(22); txt('Notas: ' + e.notas, P); }
  linea(); y += 6;
  if (firma) { const bw = W - 2 * P, bh = 210, k = Math.min(bw / firma.width, bh / firma.height); g.drawImage(firma, P + (bw - firma.width * k) / 2, y, firma.width * k, firma.height * k); y += bh; }
  else { y += 60; F(22); g.fillStyle = '#5B7680'; txt('(firma registrada en sistema)', W / 2, 'center'); g.fillStyle = '#10323D'; y += 30; }
  g.fillRect(P + 80, y, W - 2 * P - 160, 2); y += 36;
  F(26, true); txt('Recibió: ' + (e.recibio || ''), W / 2, 'center'); y += 50;
  F(20); g.fillStyle = '#5B7680'; txt('Agua Inmaculada Real del Valle · WhatsApp 33 3033 4510', W / 2, 'center'); y += P;
  const out = document.createElement('canvas'); out.width = W; out.height = y; out.getContext('2d').drawImage(tmp, 0, 0);
  return out;
}

async function mostrarNotaEntrega(id) {
  const d = await datosEntrega(id);
  const cv = await canvasNota(d);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const nombre = `Nota_${folioE(d.e.id)}_${(d.c.nombre || 'empresa').normalize('NFD').replace(/[^\w]+/g, '_')}.png`;
  const file = new File([blob], nombre, { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  modal(`<h2>Nota ${folioE(d.e.id)}</h2><p class="mut">${esc(d.c.nombre || '')} · recibió ${esc(d.e.recibio || '')}</p>
    <img src="${url}" alt="Nota de entrega" style="display:block;width:100%;max-width:360px;margin:0 auto;border:1px solid var(--line);border-radius:10px">
    <div class="row" style="margin-top:14px"><button class="btn ghost" data-close>Cerrar</button><span class="sp"></span><button class="btn sec" id="nt-d">Descargar</button><button class="btn ok" id="nt-s">Enviar por WhatsApp</button></div>
    <p class="mut small">Se abre WhatsApp con la imagen: elige el grupo o el contacto de la empresa.</p>`, box => {
    const bajar = () => { const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); };
    box.querySelector('#nt-d').onclick = bajar;
    box.querySelector('#nt-s').onclick = async () => {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Nota de entrega ' + folioE(d.e.id) }); return; }
        catch (err) { if (err && err.name === 'AbortError') return; }
      }
      bajar(); toast('Nota descargada. Adjúntala en WhatsApp.', 'ok');
    };
  });
}

function mesSiguiente(mes) { const [y, m] = mes.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }
async function estadoCuenta(clienteId, mes) {
  const ini = inicioMX(mes + '-01'), fin = inicioMX(mesSiguiente(mes) + '-01');
  const c = S.clientes.find(x => x.id == clienteId) || (await sb.from('clientes').select('*').eq('id', clienteId).single()).data;
  const [{ data: en, error }, { data: co }, { data: cxc }] = await Promise.all([
    sb.from('entregas').select('*').eq('cliente_id', clienteId).gte('fecha', ini).lt('fecha', fin).order('fecha'),
    sb.from('cobros').select('*').eq('cliente_id', clienteId).gte('fecha', ini).lt('fecha', fin).order('fecha'),
    sb.rpc('cuentas_por_cobrar')]);
  if (error) throw error;
  const ids = (en || []).map(e => e.venta_id).filter(Boolean);
  const { data: vs } = ids.length ? await sb.from('ventas').select('id,total,forma_pago,cancelada').in('id', ids) : { data: [] };
  const venta = id => (vs || []).find(v => v.id === id);
  const paths = (en || []).map(e => e.firma).filter(Boolean);
  const { data: urls } = paths.length ? await sb.storage.from('evidencias').createSignedUrls(paths, 3600) : { data: [] };
  const urlDe = p => (urls || []).find(u => u.path === p)?.signedUrl;
  const imp = e => { const v = venta(e.venta_id); return v && !v.cancelada ? num(v.total) : 0; };
  const tL = (en || []).reduce((s, e) => s + num(e.llenos), 0), tN = (en || []).reduce((s, e) => s + num(e.nuevos), 0), tV = (en || []).reduce((s, e) => s + num(e.vacios), 0);
  const tImp = (en || []).reduce((s, e) => s + imp(e), 0), tCred = (en || []).filter(e => venta(e.venta_id)?.forma_pago === 'credito').reduce((s, e) => s + imp(e), 0);
  const tPag = (co || []).reduce((s, p) => s + num(p.monto), 0);
  const saldo = num((cxc || []).find(x => x.cliente_id == clienteId)?.saldo);
  const nomMes = (m => m.charAt(0).toUpperCase() + m.slice(1))(new Date(mes + '-15T12:00:00').toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }).replace(' de ', ' '));
  const dm = t => new Date(t).toLocaleDateString('es-MX', { timeZone: CFG.ZONA, day: '2-digit', month: '2-digit' });
  const f = t => new Date(t).toLocaleString('es-MX', { timeZone: CFG.ZONA, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const doc = `<div class="ec">
    <div style="text-align:center"><img src="logo.jpg" alt="" style="width:220px"><div>Real del Valle</div>
      <h2 style="margin:10px 0 2px">ESTADO DE CUENTA</h2><div>${esc(nomMes)}</div></div>
    <p><b style="font-size:18px">${esc(c.nombre)}</b><br>${esc(txtCredito(c))}${c.contacto ? ' · ' + esc(c.contacto) : ''}</p>
    <div style="overflow-x:auto"><table class="ect"><thead><tr><th>Fecha</th><th>Llenos</th><th>Nuevos</th><th>Vacíos</th><th>Recibió</th><th style="text-align:right">Importe</th></tr></thead><tbody>
    ${(en || []).map(e => `<tr><td>${dm(e.fecha)}<br><small style="white-space:nowrap;color:#5B7680">${folioE(e.id)}</small></td><td>${e.llenos}</td><td>${num(e.nuevos) || ''}</td><td>${e.vacios}</td>
      <td>${esc(e.recibio || '')}${urlDe(e.firma) ? `<br><img src="${esc(urlDe(e.firma))}" alt="firma" style="height:28px;max-width:90px">` : ''}</td><td style="text-align:right">${money(imp(e))}${venta(e.venta_id)?.forma_pago && venta(e.venta_id).forma_pago !== 'credito' ? '<br><small>pagado</small>' : ''}</td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center">Sin entregas en el mes</td></tr>'}
    </tbody><tfoot><tr><th>Total</th><th>${tL}</th><th>${tN || ''}</th><th>${tV}</th><th></th><th style="text-align:right">${money(tImp)}</th></tr></tfoot></table></div>
    ${(co || []).length ? `<h3>Pagos recibidos en el mes</h3><table class="ect"><tbody>${co.map(p => `<tr><td>${f(p.fecha)}</td><td>${esc(p.forma_pago)}${p.notas ? ' · ' + esc(p.notas) : ''}</td><td style="text-align:right">${money(p.monto)}</td></tr>`).join('')}</tbody></table>` : ''}
    <table class="ect" style="margin-top:12px"><tbody>
      <tr><td>Entregas a crédito del mes</td><td style="text-align:right">${money(tCred)}</td></tr>
      <tr><td>Pagos del mes</td><td style="text-align:right">${money(tPag)}</td></tr>
      <tr><td><b>Saldo pendiente al ${new Date().toLocaleDateString('es-MX', { timeZone: CFG.ZONA })}</b></td><td style="text-align:right"><b>${money(saldo)}</b></td></tr></tbody></table>
    <p style="text-align:center;color:#5B7680;font-size:12px;margin-top:14px">Agua Inmaculada Real del Valle · WhatsApp 33 3033 4510</p></div>`;
  const css = `.ec{font:14px/1.4 system-ui,sans-serif;color:#10323D}.ect{width:100%;border-collapse:collapse;margin-top:8px}.ect th,.ect td{border-bottom:1px solid #dde6e9;padding:5px 3px;text-align:left;font-size:13px;vertical-align:top}.ect thead th{background:#eef4f6}`;
  const tel = soloDig(c.telefono).slice(-10);
  const msg = `Hola, le compartimos el estado de cuenta de ${c.nombre} de ${nomMes}: ${tL + tN} garrafones, ${money(tImp)}. Saldo pendiente: ${money(saldo)}. Agua Inmaculada Real del Valle.`;
  modal(`<style>${css}</style>${doc}
    <div class="row" style="margin-top:14px"><button class="btn ghost" data-close>Cerrar</button><span class="sp"></span>
      ${tel.length === 10 ? `<a class="btn sec" href="https://wa.me/52${tel}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Mensaje WhatsApp</a>` : ''}
      <button class="btn" id="ec-p">Guardar PDF</button></div>
    <p class="mut small">"Guardar PDF" abre la impresión: elige "Guardar como PDF" y luego mándalo por WhatsApp.</p>`, box => {
    box.querySelector('#ec-p').addEventListener('click', () => {
      const w = window.open('', '_blank');
      if (!w) return toast('Permite ventanas emergentes para guardar el PDF', 'bad');
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Estado de cuenta ${esc(c.nombre)} ${esc(nomMes)}</title><base href="${location.href}"><style>body{margin:24px}${css}@page{size:letter;margin:14mm}</style></head><body>${doc}<script>window.onload=()=>setTimeout(()=>print(),400)<\/script></body></html>`);
      w.document.close();
    });
  });
}

/* =====================================================================
   PANEL DE DUEÑOS: Reparto, Pedidos y Préstamos
   ===================================================================== */
VISTAS_DUENO.pedidosD = vistaPedidos;
VISTAS_DUENO.prestamosD = vistaPrestamos;
VISTAS_PLANTA.pedidos = vistaPedidos;
VISTAS_PLANTA.prestamos = vistaPrestamos;

VISTAS_DUENO.reparto = async function (main) {
  const per = selectorPeriodo(() => VISTAS_DUENO.reparto(main));
  const ini = inicioMX(S.periodo.desde), fin = inicioMX(addDays(S.periodo.hasta, 1));
  const [{ data: en }, { data: ts }, { data: pe }] = await Promise.all([
    sb.from('entregas').select('*').gte('fecha', ini).lt('fecha', fin).order('fecha', { ascending: false }),
    sb.from('turnos').select('*').in('tipo', ['camioneta', 'moto']).gte('abierto_en', ini).lt('abierto_en', fin).order('abierto_en', { ascending: false }),
    sb.from('pedidos').select('*').gte('creado_en', ini).lt('creado_en', fin)
  ]);
  // historial de 120 días para clientes nuevos / que dejaron de pedir
  const hist = await fetchAll(() => sb.from('pedidos').select('cliente_id,creado_en').neq('estado', 'cancelado').gte('creado_en', inicioMX(addDays(fechaMX(), -120))).order('id'));
  const cli = id => S.clientes.find(c => c.id === id);
  const nom = id => esc(S.perfiles.find(p => p.id === id)?.nombre || '—');
  const porEmp = {};
  (en || []).forEach(e => { const k = e.cliente_id; porEmp[k] = porEmp[k] || { llenos: 0, vacios: 0, n: 0, nuevos: 0 }; porEmp[k].llenos += e.llenos; porEmp[k].nuevos += num(e.nuevos); porEmp[k].vacios += e.vacios; porEmp[k].n++; });
  const peEnt = (pe || []).filter(p => p.estado === 'entregado');
  main.innerHTML = per.html + `
  <div class="grid g4" style="margin-bottom:16px">
    <div class="kpi"><div class="l">Garrafones a empresas</div><div class="v">${fmtN((en || []).reduce((s, e) => s + e.llenos, 0))}</div><div class="s">${(en || []).length} entregas · ${fmtN((en || []).reduce((s, e) => s + num(e.nuevos), 0))} garrafones nuevos</div></div>
    <div class="kpi"><div class="l">Vendido a empresas</div><div class="v">${money0(Object.entries(porEmp).reduce((s, [k, v]) => s + v.llenos * num(cli(Number(k))?.precio_especial) + v.nuevos * num(S.productos.find(p => p.nombre === 'Garrafón nuevo')?.precio), 0))}</div></div>
    <div class="kpi"><div class="l">Pedidos a domicilio</div><div class="v">${peEnt.length} / ${(pe || []).length}</div><div class="s">entregados / recibidos</div></div>
    <div class="kpi"><div class="l">Garrafones a domicilio</div><div class="v">${fmtN(peEnt.reduce((s, p) => s + num(p.entregado_cantidad), 0))}</div></div>
  </div>
  <div class="card"><h2>Turnos de reparto</h2><div class="tw"><table><thead><tr><th>Repartidor</th><th>Tipo</th><th>Entrada</th><th>Salida</th><th class="n">Entregados</th><th class="n">Dif. llenos</th><th class="n">Dif. vacíos</th><th class="n">Dif. caja</th></tr></thead><tbody>
    ${(ts || []).map(t => `<tr><td>${nom(t.usuario_id)}</td><td>${t.tipo === 'camioneta' ? 'Empresas' : 'Domicilio'}</td><td>${fmtFecha(t.abierto_en)}</td><td>${t.cerrado_en ? fmtHora(t.cerrado_en) : '<span class="tag warn">Abierto</span>'}</td>
      <td class="n">${t.entregados ?? '—'}</td><td class="n">${t.diferencia_llenos == null ? '—' : `<span class="tag ${t.diferencia_llenos === 0 ? 'ok' : 'bad'}">${t.diferencia_llenos}</span>`}</td>
      <td class="n">${t.diferencia_vacios == null ? '—' : `<span class="tag ${t.diferencia_vacios === 0 ? 'ok' : 'bad'}">${t.diferencia_vacios}</span>`}</td>
      <td class="n">${t.tipo === 'moto' && t.diferencia_caja != null ? `<span class="tag ${Math.abs(num(t.diferencia_caja)) <= (cfg('tolerancia_caja') || 10) ? 'ok' : 'bad'}">${money(t.diferencia_caja)}</span>` : '—'}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Sin turnos de reparto</td></tr>'}
  </tbody></table></div></div>
  <div class="grid g2">
    <div class="card"><h2>Por empresa</h2><div class="tw"><table><thead><tr><th>Empresa</th><th class="n">Entregas</th><th class="n">Llenos</th><th class="n">Vacíos</th><th class="n">En su poder</th></tr></thead><tbody>
      ${Object.entries(porEmp).map(([k, v]) => `<tr><td>${esc(cli(Number(k))?.nombre || '')}</td><td class="n">${v.n}</td><td class="n">${v.llenos}</td><td class="n">${v.vacios}</td><td class="n">${fmtN(cli(Number(k))?.garrafones_prestados)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin entregas</td></tr>'}
    </tbody></table></div></div>
    <div class="card"><h2>Entregas con firma</h2><div class="tw"><table><tbody>
      ${(en || []).slice(0, 40).map(e => `<tr><td>${fmtFecha(e.fecha)}</td><td><b>${esc(cli(e.cliente_id)?.nombre || '')}</b><br><span class="mut small">Recibió: ${esc(e.recibio || '')}</span></td><td class="n">${e.llenos} / ${e.vacios}</td><td style="white-space:nowrap">${e.firma ? `<button class="btn sm sec" data-foto="${esc(e.firma)}">Firma</button> ` : ''}<button class="btn sm ghost" data-nota="${e.id}">Nota</button></td></tr>`).join('') || '<tr><td class="empty">Sin entregas</td></tr>'}
    </tbody></table></div></div>
  </div>`;
  // ---------- Domicilio Real del Valle ----------
  const vivos = (pe || []).filter(p => p.estado !== 'cancelado');
  const marcasEnt = {};
  peEnt.forEach(p => { if (p.marcas) Object.entries(p.marcas).forEach(([m, q]) => marcasEnt[m] = (marcasEnt[m] || 0) + num(q)); else marcasEnt['Sin marca'] = (marcasEnt['Sin marca'] || 0) + num(p.entregado_cantidad); });
  const ultimo = {}, primero = {};
  hist.forEach(h => { if (!h.cliente_id) return; const t = h.creado_en; if (!ultimo[h.cliente_id] || t > ultimo[h.cliente_id]) ultimo[h.cliente_id] = t; if (!primero[h.cliente_id] || t < primero[h.cliente_id]) primero[h.cliente_id] = t; });
  const cliPer = [...new Set(vivos.map(p => p.cliente_id).filter(Boolean))];
  const nuevos = cliPer.filter(id => primero[id] >= ini).length;
  const diasSin = id => Math.floor((Date.now() - new Date(ultimo[id])) / 864e5);
  const dormidos = S.clientes.filter(c => c.tipo === 'domicilio' && ultimo[c.id] && diasSin(c.id) >= 14).sort((x, y) => diasSin(x.id) - diasSin(y.id)).slice(0, 30);
  const efe = peEnt.filter(p => p.forma_pago_real === 'efectivo').reduce((x, p) => x + num(p.monto_cobrado), 0);
  const tra = peEnt.filter(p => p.forma_pago_real === 'transferencia').reduce((x, p) => x + num(p.monto_cobrado), 0);
  main.insertAdjacentHTML('beforeend', `
  <div class="card"><h2>Domicilio · Real del Valle</h2>
    <div class="grid g4" style="margin-bottom:12px">
      <div class="kpi"><div class="l">Pedidos</div><div class="v">${fmtN(vivos.length)}</div><div class="s">${fmtN(peEnt.length)} entregados · ${fmtN(vivos.length - peEnt.length)} pendientes</div></div>
      <div class="kpi"><div class="l">Garrafones entregados</div><div class="v">${fmtN(peEnt.reduce((x, p) => x + num(p.entregado_cantidad), 0))}</div></div>
      <div class="kpi"><div class="l">Cobrado</div><div class="v">${money0(efe + tra)}</div><div class="s">Efectivo ${money0(efe)} · Transf. ${money0(tra)}</div></div>
      <div class="kpi"><div class="l">Clientes</div><div class="v">${fmtN(cliPer.length)}</div><div class="s">${fmtN(nuevos)} nuevos · ${fmtN(cliPer.length - nuevos)} que repiten</div></div>
    </div>
    <h3>Garrafones entregados por marca</h3>
    <div style="font-size:17px;margin-bottom:12px">${Object.entries(marcasEnt).sort((x, y) => y[1] - x[1]).map(([m, q]) => `<b>${fmtN(q)}</b> ${esc(m)}`).join(' · ') || '<span class="mut">Sin entregas en este periodo</span>'}</div>
    <h3>Clientes que llevan 2 semanas o más sin pedir</h3>
    <div class="tw"><table><tbody>${dormidos.map(c => `<tr><td><b>${esc(c.nombre)}</b><br><span class="mut small">${esc(c.domicilio || '')}</span></td><td>${diasSin(c.id)} días</td>
      <td>${c.telefono ? `<a class="btn sm ghost" href="https://wa.me/52${esc(soloDig(c.telefono).slice(-10))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</td></tr>`).join('') || '<tr><td class="empty">Todos tus clientes han pedido en las últimas 2 semanas</td></tr>'}</tbody></table></div>
  </div>`);
  per.bind();
  main.querySelectorAll('[data-foto]').forEach(b => b.onclick = () => verFoto(b.dataset.foto));
  main.querySelectorAll('[data-nota]').forEach(b => b.onclick = () => busy(b, () => mostrarNotaEntrega(Number(b.dataset.nota))));
};

/* ---------------- inicio ---------------- */
boot();
