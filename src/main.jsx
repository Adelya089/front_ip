
import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = '/api/1.0';
const PAGE_SIZE = 3;
let accessToken = null;
let refreshInProgress = null;

async function refreshAccessToken() {
    if (!refreshInProgress) {
        refreshInProgress = fetch('/auth/refresh', { method: 'POST', credentials: 'include' })
            .then(async res => {
                if (!res.ok) throw new Error('Сессия завершена. Выполните вход.');
                const data = await res.json();
                accessToken = data.accessToken;
                return data;
            })
            .finally(() => { refreshInProgress = null; });
    }
    return refreshInProgress;
}

async function authRequest(path, body) {
    const response = await fetch('/auth' + path, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || 'Ошибка HTTP ' + response.status);
    return result;
}


const definitions = {
    genres: {
        label: 'Жанры',
        fields: [['name', 'Название жанра', 'text', 2, 100]],
        columns: [['id', 'ID'], ['name', 'Название']]
    },
    artists: {
        label: 'Исполнители',
        fields: [
            ['name', 'Имя', 'text', 2],
            ['country', 'Страна', 'text', 2],
            ['genreId', 'Жанр', 'genres']
        ],
        columns: [
            ['id', 'ID'],
            ['name', 'Имя'],
            ['country', 'Страна'],
            ['genre.name', 'Жанр']
        ]
    },
    albums: {
        label: 'Альбомы',
        fields: [
            ['title', 'Название альбома', 'text', 2],
            ['year', 'Год', 'number'],
            ['artistId', 'Исполнитель', 'artists'],
            ['trackCount', 'Кол-во треков', 'number'],
        ],
        columns: [
            ['id', 'ID'],
            ['title', 'Название'],
            ['year', 'Год'],
            ['artist.name', 'Исполнитель'],
            ['trackCount', 'Треков']
        ]
    },
    tracks: {
        label: 'Треки',
        fields: [
            ['title', 'Название трека', 'text', 2, 100],
            ['duration', 'Длительность (сек.)', 'number'],
            ['albumId', 'Альбом', 'albums']
        ],
        columns: [
            ['id', 'ID'],
            ['title', 'Название'],
            ['duration', 'Длительность (сек.)'],
            ['albumTitle', 'Альбом']
        ]
    }
};

const emptyPages = () =>
    Object.fromEntries(Object.keys(definitions).map(key => [key, 1]));

const emptyData = () =>
    Object.fromEntries(Object.keys(definitions).map(key => [key, []]));

async function request(url, options = {}, retry = true) {
    const response = await fetch(API + url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
            ...(options.headers || {})
        }
    });

    if (response.status === 401 && retry) {
        await refreshAccessToken();
        return request(url, options, false);
    }

    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; }
    catch { data = text; }
    if (!response.ok) {
        throw new Error(data?.message || (typeof data === 'string' ? data : 'Ошибка HTTP ' + response.status));
    }
    return data;
}

function get(object, path) {
    return path.split('.').reduce((o, p) => o?.[p], object);
}

function App({ user, onLogout }) {
    const isAdmin = user.roles?.includes('ADMIN');
    const [pages, setPages] = useState(emptyPages);
    const [data, setData] = useState(emptyData);
    const [optionsData, setOptionsData] = useState(emptyData);
    const [metadata, setMetadata] = useState({});
    const [notice, setNotice] = useState(null);
    const [statistics, setStatistics] = useState({});
    const [version, setVersion] = useState(0);

    // Загружаем по 3 записи для отображения таблиц
    const load = useCallback(async () => {
        try {
            const results = {};
            const meta = {};

            for (const key of Object.keys(definitions)) {
                const result = await request(
                    '/' + key +
                    '?page=' + pages[key] +
                    '&size=' + PAGE_SIZE
                );

                if (Array.isArray(result)) {
                    results[key] = result.slice(
                        (pages[key] - 1) * PAGE_SIZE,
                        pages[key] * PAGE_SIZE
                    );

                    meta[key] = {
                        pages: Math.ceil(result.length / PAGE_SIZE),
                        items: result.length
                    };
                } else {
                    results[key] = result.data ?? [];
                    meta[key] = {
                        pages: result.pages ?? 0,
                        items: result.items ?? 0
                    };
                }
            }

            setData(results);
            setMetadata(meta);
        } catch (error) {
            setNotice({ text: error.message, error: true });
        }
    }, [pages, version]);

    useEffect(() => {
        load();
    }, [load]);

    // Загружаем ВСЕ жанры, исполнителей и альбомы
    // для выпадающих списков независимо от текущей страницы
    const loadOptions = useCallback(async () => {
        try {
            const results = {};

            for (const key of ['genres', 'artists', 'albums']) {
                const first = await request(
                    '/' + key + '?page=1&size=100'
                );

                if (Array.isArray(first)) {
                    results[key] = first;
                    continue;
                }

                const all = [...(first.data ?? [])];
                const totalPages = first.pages ?? 1;

                for (let page = 2; page <= totalPages; page++) {
                    const result = await request(
                        '/' + key +
                        '?page=' + page +
                        '&size=100'
                    );

                    all.push(...(result.data ?? []));
                }

                results[key] = all;
            }

            setOptionsData(results);
        } catch (error) {
            setNotice({ text: error.message, error: true });
        }
    }, []);

    useEffect(() => {
        loadOptions();
    }, [loadOptions, version]);

    // Добавление, изменение и удаление
    const mutate = async (key, method, id, body) => {
        try {
            await request(
                '/' + key + (id ? '/' + id : ''),
                {
                    method,
                    ...(body ? { body: JSON.stringify(body) } : {})
                }
            );

            setNotice({
                text: 'Операция выполнена успешно.',
                error: false
            });

            setVersion(n => n + 1);
            return true;
        } catch (error) {
            setNotice({ text: error.message, error: true });
            return false;
        }
    };

    // Редактирование существующей записи
    const edit = async (key, item) => {
        const initial = {
            genres: {
                name: item.name
            },
            artists: {
                name: item.name,
                country: item.country,
                genreId: item.genre?.id
            },
            albums: {
                title: item.title,
                year: item.year,
                artistId: item.artist?.id,
                trackCount: item.trackCount,
                cover: item.cover
            },
            tracks: {
                title: item.title,
                duration: item.duration,
                albumId: item.albumId
            }
        }[key];

        const obj = {};

        for (const field of definitions[key].fields) {
            const value = prompt(
                field[1],
                String(initial[field[0]] ?? '')
            );

            if (value === null) return;

            obj[field[0]] =
                field[2] === 'number' ||
                ['genres', 'artists', 'albums'].includes(field[2])
                    ? Number(value)
                    : value;
        }

        await mutate(key, 'PUT', item.id, obj);
    };

    // Статистика
    const stats = async (key) => {
        try {
            const result = await request('/' + key + '/stats');

            setStatistics(old => ({
                ...old,
                [key]: JSON.stringify(result, null, 2)
            }));
        } catch (error) {
            setNotice({ text: error.message, error: true });
        }
    };

    return (
        <>
            <header className="auth-header">
                <h1>Музыкальная база</h1>
                <div>Вход: <strong>{user.login}</strong> ({isAdmin ? 'Администратор' : 'Пользователь'})
                    <button type="button" onClick={onLogout}>Выйти</button>
                </div>
            </header>

            {notice && (
                <div
                    className={'notice' + (notice.error ? ' error' : '')}
                    role="status"
                >
                    {notice.text}
                </div>
            )}

            {Object.entries(definitions).map(([key, def]) => (
                <section key={key}>
                    <hr/>

                    <div className="bar">
                        <h2>{def.label}</h2>

                        <button
                            type="button"
                            onClick={() => stats(key)}
                        >
                            Статистика {def.label.toLowerCase()}
                        </button>
                    </div>

                    {isAdmin && <form
                        onSubmit={async e => {
                            e.preventDefault();

                            const formElement = e.currentTarget;
                            const form = new FormData(formElement);
                            const obj = {};

                            for (const field of def.fields) {
                                const raw = form.get(field[0]);

                                obj[field[0]] =
                                    field[2] === 'number' ||
                                    ['genres', 'artists', 'albums']
                                        .includes(field[2])
                                        ? Number(raw)
                                        : raw;
                            }

                            if (await mutate(key, 'POST', null, obj)) {
                                formElement.reset();
                            }
                        }}
                    >
                        {def.fields.map(
                            ([name, label, kind, min, max]) =>
                                ['genres', 'artists', 'albums']
                                    .includes(kind) ? (
                                    <select
                                        key={name}
                                        name={name}
                                        required
                                        defaultValue=""
                                    >
                                        <option value="">
                                            — {label} —
                                        </option>

                                        {(optionsData[kind] || [])
                                            .map(item => (
                                                <option
                                                    key={item.id}
                                                    value={item.id}
                                                >
                                                    {item.name || item.title}
                                                </option>
                                            ))}
                                    </select>
                                ) : (
                                    <input
                                        key={name}
                                        name={name}
                                        placeholder={label}
                                        type={kind}
                                        minLength={
                                            kind === 'text'
                                                ? min
                                                : undefined
                                        }
                                        maxLength={
                                            kind === 'text'
                                                ? max
                                                : undefined
                                        }
                                        min={
                                            kind === 'number'
                                                ? 1
                                                : undefined
                                        }
                                        required={name !== 'cover'}
                                    />
                                )
                        )}

                        <button>Добавить</button>
                    </form>}

                    <div className="table-scroll">
                        <table>
                            <thead>
                                <tr>
                                    {def.columns.map(([, label]) => (
                                        <th key={label}>{label}</th>
                                    ))}
                                    {isAdmin && <th>Действия</th>}
                                </tr>
                            </thead>

                            <tbody>
                                {(data[key] || []).map(item => (
                                    <tr key={item.id}>
                                        {def.columns.map(([path]) => (
                                            <td key={path}>
                                                {path === 'albumTitle'
                                                    ? (
                                                        optionsData.albums.find(
                                                            a =>
                                                                a.id ===
                                                                item.albumId
                                                        )?.title ||
                                                        item.albumId
                                                    )
                                                    : get(item, path)}
                                            </td>
                                        ))}

                                        {isAdmin && <td className="actions">
                                            <button
                                                type="button"
                                                onClick={() => edit(key, item)}
                                            >
                                                Ред.
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (
                                                        confirm(
                                                            'Удалить запись №' +
                                                            item.id + '?'
                                                        )
                                                    ) {
                                                        mutate(
                                                            key,
                                                            'DELETE',
                                                            item.id
                                                        );
                                                    }
                                                }}
                                            >
                                                Удал.
                                            </button>
                                        </td>}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="pager">
                        <button
                            disabled={pages[key] <= 1}
                            onClick={() =>
                                setPages(s => ({
                                    ...s,
                                    [key]: s[key] - 1
                                }))
                            }
                        >
                            ← Назад
                        </button>

                        <span>
                            Страница {pages[key]} из{' '}
                            {Math.max(metadata[key]?.pages || 0, 1)}
                            {' · '}
                            Записей: {metadata[key]?.items ?? 0}
                        </span>

                        <button
                            disabled={
                                pages[key] >=
                                Math.max(metadata[key]?.pages || 0, 1)
                            }
                            onClick={() =>
                                setPages(s => ({
                                    ...s,
                                    [key]: s[key] + 1
                                }))
                            }
                        >
                            Вперёд →
                        </button>
                    </div>

                    {statistics[key] && (
                        <pre className="stats">
                            {statistics[key]}
                        </pre>
                    )}
                </section>
            ))}
        </>
    );
}

function AuthGate() {
    const [user, setUser] = useState(null);
    const [checking, setChecking] = useState(true);
    const [mode, setMode] = useState('login');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const whoami = async () => {
        const response = await fetch('/auth/whoami', {
            headers: { Authorization: 'Bearer ' + accessToken }
        });
        if (!response.ok) throw new Error('Не удалось получить роль пользователя');
        setUser(await response.json());
    };
    useEffect(() => {
        refreshAccessToken().then(whoami).catch(() => { accessToken = null; })
            .finally(() => setChecking(false));
    }, []);

    const submit = async e => {
        e.preventDefault();
        setBusy(true); setError('');
        const form = new FormData(e.currentTarget);
        const dto = Object.fromEntries(form.entries());
        try {
            if (mode === 'signup') {
                await authRequest('/signup', dto);
                setMode('login');
                setError('Регистрация завершена. Войдите с новым логином.');
            } else {
                const result = await authRequest('/login', dto);
                accessToken = result.accessToken;
                await whoami();
            }
        } catch (err) { setError(err.message); }
        finally { setBusy(false); }
    };
    const logout = async () => {
        try { await fetch('/auth/logout', {method:'POST', credentials:'include'}); }
        finally { accessToken = null; setUser(null); setMode('login'); }
    };

    if (checking) return <p>Проверка авторизации…</p>;
    if (user) return <App user={user} onLogout={logout}/>;
    return <main className="auth-panel">
        <h1>Музыкальная база</h1>
        <h2>{mode === 'signup' ? 'Регистрация' : 'Вход'}</h2>
        <form onSubmit={submit}>
            <input name="login" placeholder="Логин" minLength={3} maxLength={20} required autoComplete="username"/>
            <input name="password" type="password" placeholder="Пароль" minLength={mode === 'signup' ? 6 : 3} required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}/>
            {mode === 'signup' && <input name="passwordConfirm" type="password" placeholder="Повторите пароль" minLength={6} required autoComplete="new-password"/>}
            <button disabled={busy}>{mode === 'signup' ? 'Зарегистрироваться' : 'Войти'}</button>
        </form>
        {error && <div className="notice" role="status">{error}</div>}
        <button type="button" onClick={() => {setError('');setMode(mode === 'signup' ? 'login' : 'signup');}}>
            {mode === 'signup' ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт'}
        </button>
        <p className="hint">После регистрации доступен просмотр каталога. Редактирование доступно администратору.</p>
    </main>;
}

createRoot(document.getElementById('root')).render(<AuthGate/>);
