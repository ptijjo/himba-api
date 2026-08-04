import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import {
  AdminLoginAttemptsQueryDto,
  UnlockLoginDto,
} from './dto/admin-login-monitor.dto';

/**
 * Moniteur sécurité auth — ADMIN uniquement (sauf page HTML shell).
 * Aligné sur /moderation/reports.
 */
@Controller()
export class AuthModerationController {
  constructor(private readonly authService: AuthService) {}

  /** Page moniteur (colle un accessToken ADMIN) — shell public, APIs protégées. */
  @Public()
  @Get('moderation/security')
  @Header('Content-Type', 'text/html; charset=utf-8')
  securityMonitorPage(): string {
    return renderSecurityMonitorHtml();
  }

  @Get('moderation/login-attempts')
  @Roles(UserRole.ADMIN)
  listLoginAttempts(@Query() query: AdminLoginAttemptsQueryDto) {
    return this.authService.listLoginAttemptsForAdmin(query);
  }

  @Get('moderation/login-locks')
  @Roles(UserRole.ADMIN)
  listLoginLocks() {
    return this.authService.listLoginLocks();
  }

  @Post('moderation/login-unlock')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  unlockLogin(@Body() dto: UnlockLoginDto) {
    return this.authService.unlockLogin(dto.login);
  }
}

function renderSecurityMonitorHtml(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Moniteur sécurité — Himba</title>
  <style>
    :root {
      --bg: #0B0618;
      --card: #1E1730;
      --text: #F5F0FF;
      --muted: rgba(245,240,255,0.65);
      --accent: #E85D04;
      --ok: #2A9D8F;
      --bad: #E83A4A;
      --line: rgba(245,240,255,0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: "Segoe UI", system-ui, sans-serif;
      background: radial-gradient(1200px 600px at 10% -10%, #2a1848, var(--bg));
      color: var(--text); min-height: 100vh; padding: 24px;
    }
    h1 { margin: 0 0 8px; font-size: 1.5rem; }
    .sub { color: var(--muted); margin-bottom: 20px; }
    .bar {
      display: flex; flex-wrap: wrap; gap: 10px; align-items: end;
      background: var(--card); padding: 16px; border-radius: 14px; margin-bottom: 20px;
    }
    label { display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 4px; }
    input, select, button {
      font: inherit; border-radius: 10px; border: 1px solid var(--line);
      background: #120c22; color: var(--text); padding: 10px 12px;
    }
    input { min-width: 280px; flex: 1; }
    button {
      background: var(--accent); border: none; font-weight: 700; cursor: pointer;
    }
    button.ghost { background: transparent; border: 1px solid var(--line); }
    button.danger { background: var(--bad); }
    .grid { display: grid; gap: 16px; grid-template-columns: 1fr; }
    @media (min-width: 960px) { .grid { grid-template-columns: 1fr 1.4fr; } }
    section {
      background: var(--card); border-radius: 14px; padding: 16px;
      border: 1px solid var(--line);
    }
    h2 { margin: 0 0 12px; font-size: 1.05rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; }
    .pill {
      display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 700;
    }
    .ok { background: rgba(42,157,143,0.2); color: var(--ok); }
    .bad { background: rgba(232,58,74,0.2); color: var(--bad); }
    .err { color: var(--bad); margin: 8px 0 0; }
    .empty { color: var(--muted); padding: 8px 0; }
    code { font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>Moniteur sécurité auth</h1>
  <p class="sub">Comptes verrouillés (Redis) + journal des tentatives. Rôle <strong>ADMIN</strong> requis.</p>

  <div class="bar">
    <div style="flex:2">
      <label for="token">Access token ADMIN</label>
      <input id="token" type="password" placeholder="Colle le Bearer accessToken…" autocomplete="off" />
    </div>
    <div>
      <label for="success">Filtre succès</label>
      <select id="success">
        <option value="">Tous</option>
        <option value="false">Échecs</option>
        <option value="true">Succès</option>
      </select>
    </div>
    <div>
      <label for="loginFilter">Login contient</label>
      <input id="loginFilter" type="text" placeholder="alice@" style="min-width:140px" />
    </div>
    <button type="button" id="refreshBtn">Rafraîchir</button>
  </div>
  <p id="status" class="err" hidden></p>

  <div class="grid">
    <section>
      <h2>Comptes bloqués</h2>
      <div id="locks"><p class="empty">Charge les données…</p></div>
    </section>
    <section>
      <h2>Journal des tentatives</h2>
      <div id="attempts"><p class="empty">Charge les données…</p></div>
    </section>
  </div>

  <script>
    const tokenEl = document.getElementById('token');
    const statusEl = document.getElementById('status');
    const locksEl = document.getElementById('locks');
    const attemptsEl = document.getElementById('attempts');
    const KEY = 'himba_admin_token';

    tokenEl.value = sessionStorage.getItem(KEY) || '';

    function token() {
      const t = tokenEl.value.trim();
      sessionStorage.setItem(KEY, t);
      return t;
    }

    function showErr(msg) {
      statusEl.hidden = !msg;
      statusEl.textContent = msg || '';
    }

    async function api(path, opts = {}) {
      const t = token();
      if (!t) throw new Error('Colle un accessToken ADMIN');
      const res = await fetch(path, {
        ...opts,
        headers: {
          'Authorization': 'Bearer ' + t,
          'Accept': 'application/json',
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
          ...(opts.headers || {}),
        },
      });
      if (!res.ok) {
        let detail = res.status + ' ' + res.statusText;
        try {
          const j = await res.json();
          if (j.message) detail = Array.isArray(j.message) ? j.message.join(', ') : j.message;
        } catch (_) {}
        throw new Error(detail);
      }
      if (res.status === 204) return null;
      return res.json();
    }

    function fmtTtl(sec) {
      if (sec == null) return '—';
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return m + 'm ' + s + 's';
    }

    function renderLocks(data) {
      const locks = data.locks || [];
      if (!locks.length) {
        locksEl.innerHTML = '<p class="empty">Aucun compte verrouillé.</p>';
        return;
      }
      locksEl.innerHTML = '<table><thead><tr><th>Login</th><th>TTL</th><th>Fails</th><th></th></tr></thead><tbody>' +
        locks.map(function (l) {
          return '<tr><td><code>' + escapeHtml(l.loginNormalized) + '</code></td><td>' +
            fmtTtl(l.ttlSeconds) + '</td><td>' + (l.failCount ?? '—') +
            '</td><td><button type="button" class="danger" data-unlock="' +
            escapeAttr(l.loginNormalized) + '">Débloquer</button></td></tr>';
        }).join('') + '</tbody></table>';

      locksEl.querySelectorAll('[data-unlock]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const login = btn.getAttribute('data-unlock');
          try {
            showErr('');
            await api('/moderation/login-unlock', {
              method: 'POST',
              body: JSON.stringify({ login: login }),
            });
            await loadAll();
          } catch (e) {
            showErr(e.message || String(e));
          }
        });
      });
    }

    function renderAttempts(data) {
      const items = data.items || [];
      if (!items.length) {
        attemptsEl.innerHTML = '<p class="empty">Aucune tentative.</p>';
        return;
      }
      attemptsEl.innerHTML = '<table><thead><tr><th>Quand</th><th>Login</th><th>Résultat</th><th>IP</th></tr></thead><tbody>' +
        items.map(function (a) {
          const cls = a.success ? 'ok' : 'bad';
          const label = a.success ? 'OK' : (a.reason || 'FAIL');
          return '<tr><td>' + escapeHtml(new Date(a.createdAt).toLocaleString('fr-FR')) +
            '</td><td><code>' + escapeHtml(a.loginNormalized) + '</code></td><td><span class="pill ' +
            cls + '">' + escapeHtml(label) + '</span></td><td>' + escapeHtml(a.ip || '—') +
            '</td></tr>';
        }).join('') + '</tbody></table>';
    }

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function escapeAttr(s) {
      return escapeHtml(s).replace(/"/g, '&quot;');
    }

    async function loadAll() {
      showErr('');
      const success = document.getElementById('success').value;
      const login = document.getElementById('loginFilter').value.trim();
      const qs = new URLSearchParams();
      qs.set('limit', '50');
      if (success !== '') qs.set('success', success);
      if (login) qs.set('login', login);

      const [locks, attempts] = await Promise.all([
        api('/moderation/login-locks'),
        api('/moderation/login-attempts?' + qs.toString()),
      ]);
      renderLocks(locks);
      renderAttempts(attempts);
    }

    document.getElementById('refreshBtn').addEventListener('click', function () {
      loadAll().catch(function (e) { showErr(e.message || String(e)); });
    });

    if (tokenEl.value) {
      loadAll().catch(function (e) { showErr(e.message || String(e)); });
    } else {
      locksEl.innerHTML = '<p class="empty">Colle un token ADMIN puis Rafraîchir.</p>';
      attemptsEl.innerHTML = '<p class="empty">Colle un token ADMIN puis Rafraîchir.</p>';
    }
  </script>
</body>
</html>`;
}
