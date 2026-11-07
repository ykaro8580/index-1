// Novo arquivo no Apps Script: várias playlists por pessoa.
// "Salvas" continua sendo a aba Playlist antiga (botão Salvar dos posts) e aparece como a primeira da lista.
// As outras ficam em Playlists (a lista) e PlaylistItens (as músicas). Itens podem ser posts do site (tocam inteiros)
// ou músicas da Apple (só a prévia de 30 segundos).
const REGEX_PREVIEW = /^https:\/\/[a-z0-9.-]*(mzstatic\.com|apple\.com)\//;

function donoDaPlaylist(id, eu) {
  const t = ler('Playlists');
  const i = t.linhas.findIndex(p => String(p.id) === String(id) && String(p.usuario_id) === String(eu.id));
  return { t, i };
}

function playlists(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const dono = d.usuario ? ler('Usuarios').linhas.find(u => String(u.usuario) === String(d.usuario)) : eu;
  if (!dono) return { ok: true, usuario: String(d.usuario), souDono: false, playlists: [] };
  const souDono = String(dono.id) === String(eu.id);
  const itens = ler('PlaylistItens').linhas;
  const salvas = ler('Playlist').linhas.filter(s => String(s.usuario_id) === String(dono.id)).length;
  const lista = [{ id: 'salvas', nome: 'Salvas', publica: true, total: salvas, capa: '' }];
  ler('Playlists').linhas
    .filter(p => String(p.usuario_id) === String(dono.id) && (souDono || String(p.publica) === 'sim'))
    .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em))
    .forEach(p => {
      const meus = itens.filter(i => String(i.playlist_id) === String(p.id));
      const comCapa = meus.find(i => i.capa_url);
      lista.push({ id: String(p.id), nome: String(p.nome), publica: String(p.publica) === 'sim', total: meus.length, capa: comCapa ? String(comCapa.capa_url) : '' });
    });
  return { ok: true, usuario: String(dono.usuario), souDono, playlists: lista };
}

function criarPlaylist(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const nome = String(d.nome || '').trim().slice(0, 60);
  if (!nome) return { ok: false, erro: 'Dê um nome para a playlist.' };
  const t = ler('Playlists');
  if (t.linhas.filter(p => String(p.usuario_id) === String(eu.id)).length >= 30) return { ok: false, erro: 'Limite de 30 playlists.' };
  const id = Utilities.getUuid();
  t.aba.appendRow([id, String(eu.id), String(eu.usuario), nome, d.publica ? 'sim' : 'nao', new Date()]);
  return { ok: true, id };
}

function editarPlaylist(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const nome = String(d.nome || '').trim().slice(0, 60);
  if (!nome) return { ok: false, erro: 'Dê um nome para a playlist.' };
  const { t, i } = donoDaPlaylist(d.playlist_id, eu);
  if (i < 0) return { ok: false, erro: 'Playlist não encontrada.' };
  t.aba.getRange(i + 2, 4, 1, 2).setValues([[nome, d.publica ? 'sim' : 'nao']]);
  return { ok: true };
}

function excluirPlaylist(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const { t, i } = donoDaPlaylist(d.playlist_id, eu);
  if (i < 0) return { ok: false, erro: 'Playlist não encontrada.' };
  removerLinhas('PlaylistItens', 'playlist_id', d.playlist_id);
  t.aba.deleteRow(i + 2);
  return { ok: true };
}

function itemDoPost(p) {
  return { tipo: 'post', ref: String(p.id), titulo: String(p.titulo), detalhe: '@' + p.usuario,
    capa_url: p.imagem_id ? 'https://lh3.googleusercontent.com/d/' + p.imagem_id : '', audio_id: String(p.audio_id || ''), preview_url: '' };
}

// as músicas de uma playlist (para "salvas", d.usuario diz de quem)
function playlistItens(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const id = String(d.playlist_id);
  const posts = ler('Posts').linhas;
  let cab, itens;
  if (id === 'salvas') {
    const dono = ler('Usuarios').linhas.find(u => String(u.usuario) === String(d.usuario || eu.usuario));
    if (!dono) return { ok: false, erro: 'Perfil não encontrado.' };
    cab = { id, nome: 'Salvas', publica: true, dono: String(dono.usuario), souDono: String(dono.id) === String(eu.id) };
    itens = ler('Playlist').linhas.filter(s => String(s.usuario_id) === String(dono.id))
      .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
      .map(s => posts.find(p => String(p.id) === String(s.post_id))).filter(p => p && p.audio_id).map(itemDoPost);
  } else {
    const pl = ler('Playlists').linhas.find(p => String(p.id) === id);
    if (!pl) return { ok: false, erro: 'Playlist não encontrada.' };
    const souDono = String(pl.usuario_id) === String(eu.id);
    if (!souDono && String(pl.publica) !== 'sim') return { ok: false, erro: 'Esta playlist é privada.' };
    cab = { id, nome: String(pl.nome), publica: String(pl.publica) === 'sim', dono: String(pl.usuario), souDono };
    itens = ler('PlaylistItens').linhas.filter(i => String(i.playlist_id) === id)
      .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em))
      .map(i => {
        if (String(i.tipo) === 'post') {
          const p = posts.find(x => String(x.id) === String(i.ref));
          return p && p.audio_id ? itemDoPost(p) : null;
        }
        return { tipo: 'apple', ref: String(i.ref), titulo: String(i.titulo), detalhe: String(i.detalhe || ''),
          capa_url: String(i.capa_url || ''), audio_id: '', preview_url: String(i.preview_url || '') };
      }).filter(Boolean);
  }
  cab.total = itens.length;
  return { ok: true, playlist: cab, itens };
}

// em quais das minhas playlists este post está
function playlistsParaPost(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const itens = ler('PlaylistItens').linhas;
  const salvo = ler('Playlist').linhas.some(s => String(s.usuario_id) === String(eu.id) && String(s.post_id) === String(d.post_id));
  const lista = [{ id: 'salvas', nome: 'Salvas', tem: salvo }];
  ler('Playlists').linhas.filter(p => String(p.usuario_id) === String(eu.id)).forEach(p => {
    lista.push({ id: String(p.id), nome: String(p.nome),
      tem: itens.some(i => String(i.playlist_id) === String(p.id) && String(i.tipo) === 'post' && String(i.ref) === String(d.post_id)) });
  });
  return { ok: true, playlists: lista };
}

// põe ou tira um post (com música) de uma das minhas playlists
function alternarPlaylistPost(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  if (String(d.playlist_id) === 'salvas') {
    const r = salvar(d);
    return r.ok ? { ok: true, tem: r.salvo } : r;
  }
  const post = ler('Posts').linhas.find(p => String(p.id) === String(d.post_id));
  if (!post || !post.audio_id) return { ok: false, erro: 'Só dá para adicionar posts com música.' };
  if (donoDaPlaylist(d.playlist_id, eu).i < 0) return { ok: false, erro: 'Playlist não encontrada.' };
  const t = ler('PlaylistItens');
  const i = t.linhas.findIndex(x => String(x.playlist_id) === String(d.playlist_id) && String(x.tipo) === 'post' && String(x.ref) === String(d.post_id));
  if (i >= 0) { t.aba.deleteRow(i + 2); return { ok: true, tem: false }; }
  t.aba.appendRow([String(d.playlist_id), 'post', String(d.post_id), '', '', '', '', new Date()]);
  return { ok: true, tem: true };
}

// música vinda da busca da Apple (toca só a prévia)
function adicionarMusica(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  if (donoDaPlaylist(d.playlist_id, eu).i < 0) return { ok: false, erro: 'Use uma das suas playlists.' };
  const m = d.item || {};
  if (!/^musica:apple:\d+$/.test(String(m.item_id))) return { ok: false, erro: 'Música inválida.' };
  if (!REGEX_PREVIEW.test(String(m.preview_url || ''))) return { ok: false, erro: 'Esta música não tem prévia disponível.' };
  const t = ler('PlaylistItens');
  if (t.linhas.some(x => String(x.playlist_id) === String(d.playlist_id) && String(x.ref) === String(m.item_id))) return { ok: false, erro: 'Essa música já está na playlist.' };
  const capa = REGEX_CAPA.test(String(m.capa_url || '')) ? String(m.capa_url) : '';
  t.aba.appendRow([String(d.playlist_id), 'apple', String(m.item_id), String(m.titulo || '').slice(0, 120), String(m.detalhe || '').slice(0, 120), capa, String(m.preview_url), new Date()]);
  return { ok: true };
}

function removerItemPlaylist(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  if (String(d.playlist_id) === 'salvas') {
    const t = ler('Playlist');
    const i = t.linhas.findIndex(x => String(x.usuario_id) === String(eu.id) && String(x.post_id) === String(d.ref));
    if (i >= 0) t.aba.deleteRow(i + 2);
    return { ok: true };
  }
  if (donoDaPlaylist(d.playlist_id, eu).i < 0) return { ok: false, erro: 'Playlist não encontrada.' };
  const t = ler('PlaylistItens');
  const i = t.linhas.findIndex(x => String(x.playlist_id) === String(d.playlist_id) && String(x.ref) === String(d.ref));
  if (i >= 0) t.aba.deleteRow(i + 2);
  return { ok: true };
}
