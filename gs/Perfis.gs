// Perfil personalizável: foto, nome, bio, cor, música fixada e favoritos.
// Os dados ficam na aba Perfis; quem ainda não editou usa os valores padrão.
const CORES = ['laranja', 'vermelho', 'azul', 'verde', 'rosa', 'amarelo'];
const REGEX_ITEM = /^(filme:tmdb|album:apple|musica:apple):\d+$/;
const REGEX_CAPA = /^https:\/\/(image\.tmdb\.org|[a-z0-9.-]*mzstatic\.com)\//;

function perfilPublico(usuario, eu) {
  const u = ler('Usuarios').linhas.find(x => String(x.usuario) === String(usuario));
  if (!u) return null;
  const p = ler('Perfis').linhas.find(x => String(x.usuario_id) === String(u.id)) || {};
  let favoritos = [];
  try { favoritos = JSON.parse(p.favoritos || '[]'); } catch (err) {}
  const souEu = String(u.id) === String(eu.id);
  const posts = ler('Posts').linhas;
  let fixada = null;
  if (p.fixada_id) {
    const post = posts.find(x => String(x.id) === String(p.fixada_id) && String(x.usuario_id) === String(u.id));
    if (post) fixada = postsComExtras([post], eu)[0];
  }
  const res = {
    usuario: String(u.usuario),
    nome: String(p.nome || u.nome || u.usuario),
    bio: String(p.bio || ''),
    foto: String(p.foto_id || ''),
    cor: CORES.indexOf(String(p.cor)) >= 0 ? String(p.cor) : 'laranja',
    favoritos, fixada, fixada_id: String(p.fixada_id || ''), souEu
  };
  if (souEu) {
    res.minhas_musicas = posts.filter(x => String(x.usuario_id) === String(u.id) && x.audio_id)
      .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
      .map(x => ({ id: String(x.id), titulo: String(x.titulo) }));
  }
  return res;
}

function salvarPerfil(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const nome = String(d.nome || '').trim().slice(0, 40) || String(eu.usuario);
  const bio = String(d.bio || '').trim().slice(0, 160);
  const cor = CORES.indexOf(String(d.cor)) >= 0 ? String(d.cor) : 'laranja';
  let fixada = String(d.fixada_id || '');
  if (fixada && !ler('Posts').linhas.some(x => String(x.id) === fixada && String(x.usuario_id) === String(eu.id) && x.audio_id)) fixada = '';
  const favoritos = (Array.isArray(d.favoritos) ? d.favoritos : []).slice(0, 4)
    .filter(f => f && CATEGORIAS.indexOf(String(f.categoria)) >= 0 && REGEX_ITEM.test(String(f.item_id)))
    .map(f => ({
      categoria: String(f.categoria), item_id: String(f.item_id),
      titulo: String(f.titulo || '').slice(0, 120), detalhe: String(f.detalhe || '').slice(0, 120),
      capa_url: REGEX_CAPA.test(String(f.capa_url || '')) ? String(f.capa_url) : ''
    }));
  const t = ler('Perfis');
  const i = t.linhas.findIndex(x => String(x.usuario_id) === String(eu.id));
  let fotoId = i >= 0 ? String(t.linhas[i].foto_id || '') : '';
  const trocarFoto = novo => {
    if (fotoId) { try { DriveApp.getFileById(fotoId).setTrashed(true); } catch (err) {} }
    fotoId = novo;
  };
  if (d.remover_foto) trocarFoto('');
  if (d.foto) trocarFoto(salvarArquivo(d.foto, 'image/jpeg', 'avatar-' + Date.now(), ['image/'], 1));
  const linha = [String(eu.id), nome, bio, fotoId, cor, fixada, JSON.stringify(favoritos), new Date()];
  if (i >= 0) t.aba.getRange(i + 2, 1, 1, 8).setValues([linha]);
  else t.aba.appendRow(linha);
  return { ok: true };
}
