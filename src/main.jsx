import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = '/api/1.0';
const PAGE_SIZE = 8;
let accessToken = null;

async function refreshToken() {
  const response = await fetch('/auth/refresh', { method: 'POST', credentials: 'include' });
  if (!response.ok) throw new Error('Войдите в аккаунт');
  const data = await response.json();
  accessToken = data.accessToken;
}

async function api(path, options = {}, repeat = true) {
  const response = await fetch(API + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...options.headers },
  });
  if (response.status === 401 && repeat) {
    await refreshToken();
    return api(path, options, false);
  }
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.message || `Ошибка ${response.status}`);
  return data;
}

const names = { genres: 'Жанры', artists: 'Исполнители', albums: 'Альбомы', tracks: 'Треки' };
const fields = {
  genres: [['name', 'Название', 'text']],
  artists: [['name', 'Название', 'text'], ['country', 'Страна', 'text'], ['genreId', 'Жанр', 'genres'], ['photo', 'Фото исполнителя (URL)', 'text']],
  albums: [['title', 'Название', 'text'], ['year', 'Год', 'number'], ['artistId', 'Исполнитель', 'artists'], ['cover', 'Обложка (URL)', 'text']],
  tracks: [['title', 'Название', 'text'], ['duration', 'Длительность (сек.)', 'number'], ['albumId', 'Альбом', 'albums']],
};

function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [register, setRegister] = useState(false);
  const [message, setMessage] = useState('');
  const [section, setSection] = useState('genres');
  const [detail, setDetail] = useState(null);
  const [catalog, setCatalog] = useState({ genres: [], artists: [], albums: [], tracks: [] });
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(null);
  const [users, setUsers] = useState([]);
  const [statistics, setStatistics] = useState([]);
  const [statsError, setStatsError] = useState('');
  const [statsFilters, setStatsFilters] = useState({ genres: '0', artists: '', albums: '1980', tracks: '0' });
  const [reload, setReload] = useState(0);
  const admin = user?.roles?.includes('ADMIN');
  const { genres, artists, albums, tracks } = catalog;

  async function loadUser() {
    const response = await fetch('/auth/whoami', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error('Не удалось получить пользователя');
    setUser(await response.json());
  }
  useEffect(() => {
    refreshToken().then(loadUser).catch(() => { accessToken = null; }).finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    Promise.all(Object.keys(names).map(key => api(`/${key}/all`)))
      .then(values => setCatalog(Object.fromEntries(Object.keys(names).map((key, i) => [key, values[i]]))))
      .catch(error => setMessage(error.message));
  }, [user, reload]);
  // Статистика из существующих методов /stats; доступна только администратору.
  useEffect(() => {
    if (!admin || !names[section]) return;
    const parameter = { genres: 'minCount', artists: 'filter', albums: 'year', tracks: 'minDuration' }[section];
    const value = statsFilters[section] ?? '';
    let cancelled = false;
    setStatistics([]);
    setStatsError('');
    api(`/${section}/stats?${parameter}=${encodeURIComponent(value)}`)
      .then(data => { if (!cancelled) setStatistics(Array.isArray(data) ? data : []); })
      .catch(error => { if (!cancelled) setStatsError(error.message); });
    return () => { cancelled = true; };
  }, [admin, section, statsFilters, reload]);

  useEffect(() => {
    if (section !== 'users' || !admin) return;
    api('/admin/users').then(data => setUsers(Array.isArray(data) ? data : data?.data || []))
      .catch(error => setMessage(error.message));
  }, [section, admin, reload]);

  const findArtist = id => artists.find(a => String(a.id) === String(id));
  const findAlbum = id => albums.find(a => String(a.id) === String(id));
  const albumArtist = album => album?.artist || findArtist(album?.artistId);
  const trackAlbum = track => findAlbum(track.albumId);
  const trackArtist = track => albumArtist(trackAlbum(track));
  const trackGenreId = track => trackArtist(track)?.genre?.id;
  const genreTracks = genre => tracks.filter(track => String(trackGenreId(track)) === String(genre.id));
  const artistAlbums = artist => albums.filter(album => String(albumArtist(album)?.id) === String(artist.id));
  const artistTracks = artist => tracks.filter(track => String(trackArtist(track)?.id) === String(artist.id));
  const albumTracks = album => tracks.filter(track => String(track.albumId) === String(album.id));
  const duration = n => { const seconds = Math.floor(Number(n) || 0); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };

  function open(sectionName, item = null) {
    setSection(sectionName);
    setDetail(item);
    setSearch('');
    setPage(1);
    setForm(null);
    setMessage('');
  }
  async function login(event) {
    event.preventDefault();
    setMessage('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch('/auth/' + (register ? 'signup' : 'login'), {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'Ошибка входа');
      if (register) { setRegister(false); setMessage('Регистрация выполнена. Теперь войдите.'); }
      else { accessToken = result.accessToken; await loadUser(); }
    } catch (error) { setMessage(error.message); }
  }
  async function logout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    accessToken = null;
    setUser(null);
    open('genres');
  }
  async function saveCatalog(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    for (const [key, , type] of fields[form.kind]) {
      if (type === 'number' || names[type]) values[key] = Number(values[key]);
    }
    // Не отправляем NaN: JSON превращает его в null, что вызывает @NotNull на сервере.
    for (const [key, , type] of fields[form.kind]) {
      if ((type === 'number' || names[type]) && (!Number.isFinite(values[key]) || values[key] < 1)) {
        setMessage(key === 'artistId' ? 'Выберите исполнителя' : 'Проверьте числовые поля формы');
        return;
      }
    }
    if (form.kind === 'artists') {
      const photo = (values.photo || '').trim();
      if (photo && !(photo.startsWith('/artists/') || /^https?:\/\//i.test(photo))) {
        setMessage('Укажите ссылку https://... или /artists/имя-файла');
        return;
      }
      if (photo.length > 255) {
        setMessage('Ссылка на фото слишком длинная (максимум 255 символов)');
        return;
      }
      values.photo = photo || null;
    }
    if (form.kind === 'albums') {
      if (!Number.isInteger(values.artistId) || !artists.some(a => a.id === values.artistId)) {
        setMessage('Выберите исполнителя из списка');
        return;
      }
      const year = values.year;
      const currentYear = new Date().getFullYear();
      if (!Number.isInteger(year) || year < 1980 || year > currentYear) {
        setMessage(`Год должен быть от 1980 до ${currentYear}`);
        return;
      }
      const cover = (values.cover || '').trim();
      if (cover && !(cover.startsWith('/covers/') || /^https?:\/\//i.test(cover))) {
        setMessage('Укажите ссылку https://... или путь /covers/имя-файла');
        return;
      }
      if (cover.length > 255) {
        setMessage('Ссылка на обложку слишком длинная (максимум 255 символов)');
        return;
      }
      values.cover = cover || null;
    }
    for (const key of ['title', 'name']) {
      if (typeof values[key] === 'string') {
        values[key] = values[key].trim();
        if (values[key].length < 2 || values[key].length > 100) {
          setMessage('Название должно содержать от 2 до 100 символов');
          return;
        }
      }
    }
    setMessage('');
    try {
      await api(`/${form.kind}${form.item ? '/' + form.item.id : ''}`, {
        method: form.item ? 'PUT' : 'POST', body: JSON.stringify(values),
      });
      setForm(null);
      setReload(n => n + 1);
      setMessage('Сохранено');
    } catch (error) { setMessage(error.message); }
  }
  async function removeCatalog(kind, item) {
    if (!window.confirm('Удалить запись?')) return;
    try { await api(`/${kind}/${item.id}`, { method: 'DELETE' }); setReload(n => n + 1); setMessage('Удалено'); }
    catch (error) { setMessage(error.message); }
  }
  async function manageUser(path, method, body) {
    try {
      await api('/admin/users' + path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      setReload(n => n + 1);
      setMessage('Готово');
    } catch (error) { setMessage(error.message); }
  }

  if (checking) return <p className="center">Загрузка...</p>;
  if (!user) return <div className="login"><h1>Музыкальный каталог</h1><h2>{register ? 'Регистрация' : 'Вход'}</h2>
    <form onSubmit={login}>
      <label>Логин<input name="login" minLength="3" maxLength="20" required /></label>
      <label>Пароль<input name="password" type="password" minLength={register ? 6 : 1} required /></label>
      {register && <label>Повторите пароль<input name="passwordConfirm" type="password" minLength="6" required /></label>}
      <button type="submit">{register ? 'Зарегистрироваться' : 'Войти'}</button>
    </form>
    {message && <p className="message">{message}</p>}
    <button className="link" onClick={() => { setRegister(!register); setMessage(''); }}>{register ? 'Уже есть аккаунт? Войти' : 'Зарегистрироваться'}</button>
  </div>;

  // Связанные записи получаем из общего каталога, без дополнительных запросов.
  let items = catalog[section] || [];
  if (section === 'genres') items = detail ? genreTracks(detail) : tracks;
  if (section === 'artists' && detail) items = artistAlbums(detail);
  if (section === 'albums' && detail) items = albumTracks(detail);
  if (!detail && section === 'artists' && genreFilter) items = items.filter(a => String(a.genre?.id) === genreFilter);
  if (!detail && section === 'albums' && yearFilter) items = items.filter(a => String(a.year) === yearFilter);
  const displayedKind = section === 'genres' ? 'tracks' : detail ? (section === 'artists' ? 'albums' : 'tracks') : section;
  const label = item => displayedKind === 'tracks'
    ? [item.title, trackArtist(item)?.name, trackAlbum(item)?.title].join(' ')
    : [item.name || item.title, item.country || '', item.year || ''].join(' ');
  const visible = items.filter(item => label(item).toLowerCase().includes(search.toLowerCase()));
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pageNumber = Math.min(page, pages);
  const pageItems = visible.slice((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE);

  function actions(kind, item) {
    return admin && <span className="actions">
      <button onClick={() => { setMessage(''); setForm({ kind, item }); }}>Изменить</button>
      <button onClick={() => removeCatalog(kind, item)}>Удалить</button>
    </span>;
  }
  function rowCells(item) {
    if (displayedKind === 'genres') return [
      <td key="name"><button className="text-button" onClick={() => open('genres', item)}>{item.name}</button></td>,
      <td key="actions">{actions('genres', item)}</td>,
    ];
    if (displayedKind === 'artists') return [
      <td key="name"><button className="text-button" onClick={() => open('artists', item)}>{item.name}</button></td>,
      <td key="genre">{item.genre?.name || '—'}</td>,
      <td key="country">{item.country || '—'}</td>,
      <td key="actions">{actions('artists', item)}</td>,
    ];
    if (displayedKind === 'albums') return [
      <td key="title"><button className="text-button" onClick={() => open('albums', item)}>{item.title}</button></td>,
      <td key="artist">{albumArtist(item) ? <button className="text-button" onClick={() => open('artists', albumArtist(item))}>{albumArtist(item).name}</button> : '—'}</td>,
      <td key="year">{item.year}</td>,
      <td key="actions">{actions('albums', item)}</td>,
    ];
    return [
      <td key="title">{item.title}</td>,
      <td key="artist">{trackArtist(item) ? <button className="text-button" onClick={() => open('artists', trackArtist(item))}>{trackArtist(item).name}</button> : '—'}</td>,
      <td key="album">{trackAlbum(item) ? <button className="text-button" onClick={() => open('albums', trackAlbum(item))}>{trackAlbum(item).title}</button> : '—'}</td>,
      <td key="duration">{duration(item.duration)}</td>,
      <td key="actions">{actions('tracks', item)}</td>,
    ];
  }

  return <div className="layout">
    <aside className="sidebar"><h2>Музыкальный каталог</h2>
      <nav className="sidebar-nav">
        {Object.entries(names).map(([key, title]) => <button key={key} className={section === key ? 'selected' : ''} onClick={() => open(key)}>{title}</button>)}
        {admin && <div className="admin-nav"><button className={section === 'users' ? 'selected' : ''} onClick={() => open('users')}>Пользователи</button></div>}
      </nav>
      <div className="account"><div>{user.login} ({admin ? 'ADMIN' : 'USER'})</div><button onClick={logout}>Выйти</button></div>
    </aside>
    <main className="content">
      <h1>{section === 'users' ? 'Пользователи' : names[section]}</h1>
      {detail && <button className="link" onClick={() => open(section)}>← Назад к списку</button>}
      {message && <p className="message">{message}</p>}
      {section !== 'users' && <>
        {section === 'genres' && <section className="browse-section">
          <h2>Жанры</h2><p className="section-note">Нажмите на жанр, чтобы посмотреть его песни.</p>
          <div className="genre-cards">
            <button type="button" className={`genre-card ${!detail ? 'active' : ''}`} onClick={() => open('genres')}>
              <span className="genre-icon">♫</span><strong>Все жанры</strong><span>{tracks.length} песен</span>
            </button>
            {genres.map(genre => <button type="button" key={genre.id} className={`genre-card ${String(detail?.id) === String(genre.id) ? 'active' : ''}`} onClick={() => open('genres', genre)}>
              <span className="genre-icon">♪</span><strong>{genre.name}</strong><span>{genreTracks(genre).length} песен</span>
            </button>)}
          </div>
          {genres.length === 0 && <p>Жанры пока не добавлены или не загрузились.</p>}
          <h2>{detail ? `Песни жанра «${detail.name}»` : 'Все песни'}</h2>
        </section>}
        {section === 'artists' && detail && <div className="detail-heading"><div className="detail-cover">{detail.photo ? <img src={detail.photo} alt={`Фото исполнителя ${detail.name}`} onError={e => { e.currentTarget.style.display = 'none'; }} /> : '♪'}</div><div><span className="detail-type">Исполнитель</span><h2>{detail.name}</h2><p>{detail.genre?.name || 'Жанр не указан'} · {detail.country || 'Страна не указана'} · Альбомов: {artistAlbums(detail).length}</p></div></div>}
        {section === 'albums' && detail && <div className="detail-heading"><div className="detail-cover">{detail.cover ? <img src={detail.cover} alt="Обложка альбома" onError={e => { e.currentTarget.style.display = 'none'; }} /> : '♫'}</div><div><span className="detail-type">Альбом</span><h2>{detail.title}</h2><p><button className="detail-artist" onClick={() => albumArtist(detail) && open('artists', albumArtist(detail))}>{albumArtist(detail)?.name || 'Исполнитель не указан'}</button> · {detail.year} · {albumTracks(detail).length} песен</p></div></div>}
        {!detail && section === 'artists' && <label className="filter">Жанр: <select value={genreFilter} onChange={e => { setGenreFilter(e.target.value); setPage(1); }}><option value="">Все</option>{genres.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
        {!detail && section === 'albums' && <label className="filter">Год: <select value={yearFilter} onChange={e => { setYearFilter(e.target.value); setPage(1); }}><option value="">Все</option>{[...new Set(albums.map(a => a.year))].sort((a, b) => b - a).map(y => <option key={y} value={y}>{y}</option>)}</select></label>}
        {section === 'artists' && detail && <h2>Альбомы исполнителя</h2>}
        {section === 'albums' && detail && <h2>Треки альбома</h2>}
        <div className="toolbar"><input placeholder="Поиск" aria-label="Поиск" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          {admin && !detail && section !== 'genres' && <button onClick={() => { setMessage(''); setForm({ kind: section, item: null }); }}>Добавить</button>}
          {admin && section === 'genres' && <button onClick={() => { setMessage(''); setForm({ kind: 'genres', item: null }); }}>Добавить жанр</button>}
        </div>
        {(displayedKind === 'artists' || displayedKind === 'albums') ? <div className="catalog-cards">
          {pageItems.map(item => <article className="catalog-card" key={item.id}>
            <button type="button" className="card-open" onClick={() => open(displayedKind, item)}>
              <div className="card-picture">{(displayedKind === 'albums' ? item.cover : item.photo) ? <img src={displayedKind === 'albums' ? item.cover : item.photo} alt={displayedKind === 'artists' ? 'Фото исполнителя' : 'Обложка альбома'} onError={e => { e.currentTarget.style.display = 'none'; }} /> : <span>{displayedKind === 'artists' ? '♪' : '♫'}</span>}</div>
              <strong>{item.name || item.title}</strong>
              <span>{displayedKind === 'artists' ? `${item.genre?.name || 'Без жанра'} · ${item.country || 'Страна не указана'}` : `${albumArtist(item)?.name || 'Исполнитель не указан'} · ${item.year}`}</span>
              <small>{displayedKind === 'artists' ? `Альбомов: ${artistAlbums(item).length}` : `Треков: ${albumTracks(item).length}`}</small>
            </button>
            {actions(displayedKind, item)}
          </article>)}
          {!visible.length && <p className="empty">Нет записей</p>}
        </div> : <div className="song-list">
          {pageItems.map((item, index) => <div className="song-row" key={item.id}>
            <span className="song-number">{(pageNumber - 1) * PAGE_SIZE + index + 1}</span>
            <div className="song-art">{trackAlbum(item)?.cover ? <img src={trackAlbum(item).cover} alt="Обложка альбома" onError={e => { e.currentTarget.style.display = 'none'; }} /> : '♪'}</div>
            <div className="song-info"><strong>{item.title}</strong>
              {trackArtist(item) ? <button className="song-meta" onClick={() => open('artists', trackArtist(item))}>{trackArtist(item).name}</button> : <small>Исполнитель не указан</small>}
            </div>
            {trackAlbum(item) ? <button className="song-album" onClick={() => open('albums', trackAlbum(item))}>{trackAlbum(item).title}</button> : <span className="song-album">—</span>}
            <span className="song-duration">{duration(item.duration)}</span>
            {admin && <div className="song-actions">{actions('tracks', item)}</div>}
          </div>)}
          {!visible.length && <p className="empty">Песни не найдены</p>}
        </div>}
        <div className="pagination"><button disabled={pageNumber === 1} onClick={() => setPage(pageNumber - 1)}>Назад</button><span>Страница {pageNumber} из {pages}</span><button disabled={pageNumber === pages} onClick={() => setPage(pageNumber + 1)}>Вперёд</button></div>
        {section === 'artists' && detail && <section className="browse-section songs-panel"><h2>Песни исполнителя</h2>
          {artistTracks(detail).length ? <div className="song-list">{artistTracks(detail).map((track, index) => <div className="song-row" key={track.id}>
            <span className="song-number">{index + 1}</span>
            <div className="song-info"><strong>{track.title}</strong><small>{detail.name}</small></div>
            <button className="song-album" onClick={() => trackAlbum(track) && open('albums', trackAlbum(track))}>{trackAlbum(track)?.title || 'Альбом'}</button>
            <span className="song-duration">{duration(track.duration)}</span>
          </div>)}</div> : <p>У исполнителя пока нет треков</p>}
        </section>}
        {section === 'genres' && admin && <section className="browse-section"><h2>Редактирование жанров</h2><div className="table-wrap"><table><thead><tr><th>Жанр</th><th>Действия</th></tr></thead><tbody>{genres.map(genre => <tr key={genre.id}><td>{genre.name}</td><td>{actions('genres', genre)}</td></tr>)}</tbody></table></div></section>}
      </>}
      {admin && names[section] && <section className="statistics-panel">
        <h2>Статистика — {names[section].toLowerCase()}</h2>
        <div className="stats-filter">
          {section === 'genres' && <label>Минимум исполнителей
            <input type="number" min="0" value={statsFilters.genres} onChange={e => setStatsFilters(p => ({ ...p, genres: e.target.value }))} />
          </label>}
          {section === 'artists' && <label>Поиск исполнителя
            <input value={statsFilters.artists} onChange={e => setStatsFilters(p => ({ ...p, artists: e.target.value }))} placeholder="Имя" />
          </label>}
          {section === 'albums' && <label>Альбомы начиная с года
            <input type="number" min="1980" max={new Date().getFullYear()} value={statsFilters.albums} onChange={e => setStatsFilters(p => ({ ...p, albums: e.target.value }))} />
          </label>}
          {section === 'tracks' && <label>Минимальная длительность, сек.
            <input type="number" min="0" value={statsFilters.tracks} onChange={e => setStatsFilters(p => ({ ...p, tracks: e.target.value }))} />
          </label>}
        </div>
        {statsError && <p className="form-error">{statsError}</p>}
        <div className="table-wrap"><table>
          <thead><tr>
            <th>{section === 'genres' ? 'Жанр' : section === 'artists' ? 'Исполнитель' : 'Альбом'}</th>
            <th>{section === 'genres' ? 'Исполнителей' : section === 'artists' ? 'Альбомов' : 'Треков'}</th>
            {section === 'tracks' && <th>Средняя длительность, сек.</th>}
          </tr></thead>
          <tbody>{statistics.map((item, index) => <tr key={index}>
            <td>{item.genreName || item.artistName || item.albumTitle}</td>
            <td>{item.artistCount ?? item.albumCount ?? item.trackCount ?? 0}</td>
            {section === 'tracks' && <td>{item.averageDurationSeconds == null ? '—' : Number(item.averageDurationSeconds).toFixed(1)}</td>}
          </tr>)}</tbody>
        </table></div>
        {!statistics.length && !statsError && <p>Нет данных по выбранным условиям</p>}
      </section>}
      {section === 'users' && admin && <>
        <form className="user-form" onSubmit={e => { e.preventDefault(); manageUser('', 'POST', Object.fromEntries(new FormData(e.currentTarget))); e.currentTarget.reset(); }}>
          <h2>Добавить пользователя</h2><label>Логин<input name="login" minLength="3" maxLength="20" required /></label><label>Пароль<input name="password" type="password" minLength="6" required /></label><label>Роль<select name="role"><option value="USER">USER</option><option value="ADMIN">ADMIN</option></select></label><button type="submit">Добавить</button>
        </form>
        <div className="table-wrap"><table><thead><tr><th>Логин</th><th>Роль</th><th>Статус</th><th>Действия</th></tr></thead><tbody>
          {users.map(item => <tr key={item.id}><td>{item.login}</td><td>{item.role}</td><td>{item.enabled ? 'Активен' : 'Заблокирован'}</td><td className="actions">
            <button disabled={item.login === user.login} onClick={() => manageUser(`/${item.id}/${item.enabled ? 'block' : 'unblock'}`, 'PATCH')}>{item.enabled ? 'Заблокировать' : 'Разблокировать'}</button>
            <button disabled={item.login === user.login} onClick={() => window.confirm('Удалить пользователя?') && manageUser('/' + item.id, 'DELETE')}>Удалить</button>
          </td></tr>)}
        </tbody></table></div>
      </>}
      {form && <div className="modal"><form onSubmit={saveCatalog}>
        <h2>{form.item ? 'Изменить' : 'Добавить'} — {names[form.kind]}</h2>
        {message && <p className="form-error" role="alert">{message}</p>}
        {fields[form.kind].map(([key, title, type]) => {
          const value = form.item ? (key.endsWith('Id') ? form.item[key.slice(0, -2).toLowerCase()]?.id ?? form.item[key] : form.item[key]) : '';
          return <label key={key}>{title}{names[type] ? <select name={key} defaultValue={value ?? ''} required><option value="">Выберите</option>{catalog[type].map(item => <option key={item.id} value={item.id}>{item.name || item.title}</option>)}</select> : <input name={key} type={type} defaultValue={value ?? ''} required={key !== 'cover' && key !== 'photo'} min={key === 'year' ? 1980 : type === 'number' ? 1 : undefined} max={key === 'year' ? new Date().getFullYear() : undefined} minLength={key === 'title' || key === 'name' ? 2 : undefined} maxLength={key === 'cover' || key === 'photo' ? 255 : key === 'title' || key === 'name' ? 100 : undefined} step={type === 'number' ? 1 : undefined} />}</label>;
        })}
        <div className="buttons"><button type="submit">Сохранить</button><button type="button" onClick={() => { setForm(null); setMessage(''); }}>Отмена</button></div>
      </form></div>}
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
