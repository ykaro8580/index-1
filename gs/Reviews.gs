// Novo arquivo no Apps Script: reviews de filmes, músicas e álbuns.
// Filmes: TMDB (precisa de chave gratuita). Músicas e álbuns: iTunes Search (sem chave).
const TMDB_CHAVE = 'cole-a-chave-do-tmdb-aqui';
const CATEGORIAS = ['filme', 'musica', 'album'];

// rode esta função uma vez para o Google pedir a permissão de acessar serviços externos
function autorizarBusca() {
  UrlFetchApp.fetch('https://itunes.apple.com/search?term=queen&limit=1');
}

function normalizar(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
}

// a categoria vem do próprio item (filme:tmdb:1, album:apple:2, manual:filme:...), então nunca fica diferente do título escolhido
function categoriaDoItem(itemId, padrao) {
  const partes = String(itemId || '').split(':');
  const c = partes[0] === 'manual' ? partes[1] : partes[0];
  return CATEGORIAS.indexOf(c) >= 0 ? c : String(padrao);
}

// o alvo de uma curtida ou comentário pode ser um post ou uma review
function alvoDe(id) {
  const alvo = x => String(x.id) === String(id);
  return ler('Posts').linhas.find(alvo) || ler('Reviews').linhas.find(alvo) || null;
}

function buscarFilme(termo) {
  if (TMDB_CHAVE.indexOf('cole-') === 0) throw new Error('Falta a chave do TMDB.');
  const url = 'https://api.themoviedb.org/3/search/movie?language=pt-BR&include_adult=false&query=' + encodeURIComponent(termo) + '&api_key=' + TMDB_CHAVE;
  const j = JSON.parse(UrlFetchApp.fetch(url).getContentText());
  return (j.results || []).slice(0, 8).map(f => ({
    item_id: 'filme:tmdb:' + f.id,
    titulo: f.title,
    detalhe: String(f.release_date || '').slice(0, 4),
    capa_url: f.poster_path ? 'https://image.tmdb.org/t/p/w342' + f.poster_path : ''
  }));
}

function buscarApple(termo, categoria) {
  const entidade = categoria === 'album' ? 'album' : 'song';
  const url = 'https://itunes.apple.com/search?media=music&limit=8&country=BR&entity=' + entidade + '&term=' + encodeURIComponent(termo);
  const j = JSON.parse(UrlFetchApp.fetch(url).getContentText());
  return (j.results || []).slice(0, 8).map(r => {
    const capa = String(r.artworkUrl100 || '').replace('100x100', '300x300');
    const ano = String(r.releaseDate || '').slice(0, 4);
    return categoria === 'album'
      ? { item_id: 'album:apple:' + r.collectionId, titulo: r.collectionName, detalhe: r.artistName + (ano ? ', ' + ano : ''), capa_url: capa }
      : { item_id: 'musica:apple:' + r.trackId, titulo: r.trackName, detalhe: r.artistName + (r.collectionName ? ', ' + r.collectionName : ''), capa_url: capa, preview_url: String(r.previewUrl || '') };
  });
}

function buscarItem(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const categoria = String(d.categoria);
  if (CATEGORIAS.indexOf(categoria) < 0) return { ok: false, erro: 'Categoria inválida.' };
  const termo = String(d.termo || '').trim().slice(0, 80);
  if (termo.length < 2) return { ok: true, itens: [] };
  const cache = CacheService.getScriptCache();
  const chave = 'busca:' + categoria + ':' + normalizar(termo);
  const guardado = cache.get(chave);
  if (guardado) return { ok: true, itens: JSON.parse(guardado) };
  let itens;
  try {
    itens = categoria === 'filme' ? buscarFilme(termo) : buscarApple(termo, categoria);
  } catch (err) {
    return { ok: false, erro: err.message === 'Falta a chave do TMDB.' ? err.message : 'A busca não respondeu. Tente de novo ou preencha à mão.' };
  }
  cache.put(chave, JSON.stringify(itens), 21600);
  return { ok: true, itens };
}

// uma review por pessoa e por título: postar de novo atualiza a anterior
function postarReview(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const categoria = String(d.categoria);
  if (CATEGORIAS.indexOf(categoria) < 0) return { ok: false, erro: 'Categoria inválida.' };
  const titulo = String(d.titulo || '').trim().slice(0, 120);
  const detalhe = String(d.detalhe || '').trim().slice(0, 120);
  if (!titulo) return { ok: false, erro: 'Escolha ou escreva o título.' };
  const nota = Number(d.nota);
  if (!(nota >= 0.5 && nota <= 5) || (nota * 2) % 1 !== 0) return { ok: false, erro: 'Nota inválida.' };
  const texto = String(d.texto || '').trim().slice(0, 1500);
  let capa = String(d.capa_url || '');
  if (capa && !/^https:\/\/(image\.tmdb\.org|[a-z0-9.-]*mzstatic\.com)\//.test(capa)) capa = '';
  let item = String(d.item_id || '');
  if (!item) item = 'manual:' + categoria + ':' + normalizar(titulo + detalhe);
  else if (!/^(filme:tmdb|album:apple|musica:apple):\d+$/.test(item)) return { ok: false, erro: 'Item inválido.' };
  const t = ler('Reviews');
  const i = t.linhas.findIndex(r => String(r.usuario_id) === String(eu.id) && String(r.item_id) === item);
  if (i >= 0) {
    t.aba.getRange(i + 2, 9, 1, 3).setValues([[nota, texto, new Date()]]);
    return { ok: true, atualizada: true };
  }
  t.aba.appendRow([Utilities.getUuid(), String(eu.id), String(eu.usuario), categoriaDoItem(item, categoria), item, titulo, detalhe, capa, nota, texto, new Date()]);
  return { ok: true, atualizada: false };
}

// lista de reviews; filtros opcionais: categoria, usuario, item_id (com item_id vem também a média)
function reviews(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  let lista = ler('Reviews').linhas;
  if (d.item_id) lista = lista.filter(r => String(r.item_id) === String(d.item_id));
  if (d.categoria) lista = lista.filter(r => categoriaDoItem(r.item_id, r.categoria) === String(d.categoria));
  if (d.usuario) lista = lista.filter(r => String(r.usuario) === String(d.usuario));
  lista.sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em));
  const saida = reviewsComExtras(lista.slice(0, 50), eu);
  let resumo = null;
  if (d.item_id) {
    const soma = lista.reduce((a, r) => a + Number(r.nota), 0);
    resumo = { total: lista.length, media: lista.length ? Math.round(soma / lista.length * 10) / 10 : 0 };
  }
  return { ok: true, eu: String(eu.usuario), reviews: saida, resumo };
}

function apagarReview(d) {
  const eu = usuarioDoToken(d.token);
  if (!eu) return SESSAO_EXPIRADA;
  const t = ler('Reviews');
  const i = t.linhas.findIndex(r => String(r.id) === String(d.review_id));
  if (i < 0) return { ok: false, erro: 'Review não encontrada.' };
  if (String(t.linhas[i].usuario_id) !== String(eu.id)) return { ok: false, erro: 'Você só pode apagar as suas reviews.' };
  ['Curtidas', 'Comentarios'].forEach(nome => removerLinhas(nome, 'post_id', d.review_id));
  t.aba.deleteRow(i + 2);
  return { ok: true };
}

// reviews já com curtidas, comentários e a foto de quem escreveu (usado na aba Reviews e no feed principal)
function reviewsComExtras(rows, eu) {
  const curtidas = ler('Curtidas').linhas, coment = ler('Comentarios').linhas;
  const fotos = {};
  ler('Perfis').linhas.forEach(x => { fotos[String(x.usuario_id)] = String(x.foto_id || ''); });
  return rows.map(r => {
    const id = String(r.id);
    const dele = curtidas.filter(c => String(c.post_id) === id);
    return {
      id, usuario: String(r.usuario), categoria: categoriaDoItem(r.item_id, r.categoria), item_id: String(r.item_id),
      titulo: String(r.titulo), detalhe: String(r.detalhe || ''), capa_url: String(r.capa_url || ''),
      nota: Number(r.nota), texto: String(r.texto || ''), criado_em: r.criado_em,
      curtidas: dele.length, curti: dele.some(c => String(c.usuario_id) === String(eu.id)),
      comentarios: coment.filter(c => String(c.post_id) === id).length,
      avatar: fotos[String(r.usuario_id)] || ''
    };
  });
}
