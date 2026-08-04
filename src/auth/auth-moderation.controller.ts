import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
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

  /**
   * Page moniteur (colle un accessToken ADMIN).
   * Envoi via Res pour contrôler CSP (scripts inline autorisés sur cette page).
   */
  @Public()
  @Get('moderation/security')
  securityMonitorPage(@Res() res: Response): void {
    res
      .status(HttpStatus.OK)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      // 1. Autoriser le JS inline de cette page (Helmet CSP globale sinon bloque)
      .setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
      )
      .send(renderSecurityMonitorHtml());
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
      --bg: #0B0618; --card: #1E1730; --text: #F5F0FF;
      --muted: rgba(245,240,255,0.65); --accent: #E85D04;
      --ok: #2A9D8F; --bad: #E83A4A; --line: rgba(245,240,255,0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: "Segoe UI", system-ui, sans-serif;
      background: radial-gradient(1200px 600px at 10% -10%, #2a1848, var(--bg));
      color: var(--text); min-height: 100vh; padding: 24px;
    }
    h1 { margin: 0 0 8px; font-size: 1.5rem; }
    .sub { color: var(--muted); margin-bottom: 16px; }
    .bar {
      display: flex; flex-wrap: wrap; gap: 10px; align-items: end;
      background: var(--card); padding: 16px; border-radius: 14px; margin-bottom: 12px;
    }
    label { display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 4px; }
    input, select, button {
      font: inherit; border-radius: 10px; border: 1px solid var(--line);
      background: #120c22; color: var(--text); padding: 10px 12px;
    }
    input { min-width: 280px; flex: 1; }
    button { background: var(--accent); border: none; font-weight: 700; cursor: pointer; }
    button.danger { background: var(--bad); }
    button:disabled { opacity: 0.6; cursor: wait; }
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
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 0.75rem; font-weight: 700;
    }
    .ok { background: rgba(42,157,143,0.2); color: var(--ok); }
    .bad { background: rgba(232,58,74,0.2); color: var(--bad); }
    .err {
      display: none; background: rgba(232,58,74,0.15); border: 1px solid var(--bad);
      color: #ffb4ba; padding: 10px 12px; border-radius: 10px; margin-bottom: 16px;
    }
    .err.visible { display: block; }
    .empty { color: var(--muted); padding: 8px 0; }
    code { font-size: 0.8rem; }
    .hint { font-size: 0.85rem; color: var(--muted); margin: 0 0 16px; }
  </style>
</head>
<body>
  <h1>Moniteur sécurité auth</h1>
  <p class="sub">Comptes verrouillés (Redis) + journal des tentatives. Rôle <strong>ADMIN</strong> requis.</p>
  <p class="hint">1) POST /auth/login avec le compte ADMIN → 2) copie <code>accessToken</code> → 3) colle ici → 4) Rafraîchir.</p>

  <div class="bar">
    <div style="flex:2">
      <label for="token">Access token ADMIN</label>
      <input id="token" type="password" placeholder="Colle accessToken (sans le mot Bearer)" autocomplete="off" />
    </div>
    <div>
      <label for="success">Filtre succès</label>
      <select id="success">
        <option value="" selected>Tous</option>
        <option value="false">Échecs</option>
        <option value="true">Succès</option>
      </select>
    </div>
    <div>
      <label for="loginFilter">Login contient</label>
      <input id="loginFilter" type="text" placeholder="ex. admin@" style="min-width:140px" />
    </div>
    <button type="button" id="refreshBtn">Rafraîchir</button>
  </div>
  <div id="status" class="err" role="alert"></div>

  <div class="grid">
    <section>
      <h2>Comptes bloqués</h2>
      <div id="locks"><p class="empty">Colle un token puis clique Rafraîchir.</p></div>
    </section>
    <section>
      <h2>Journal des tentatives</h2>
      <div id="attempts"><p class="empty">Colle un token puis clique Rafraîchir.</p></div>
    </section>
  </div>

  <script>
(function () {
  var tokenEl = document.getElementById('token');
  var statusEl = document.getElementById('status');
  var locksEl = document.getElementById('locks');
  var attemptsEl = document.getElementById('attempts');
  var refreshBtn = document.getElementById('refreshBtn');
  var KEY = 'himba_admin_token';

  tokenEl.value = sessionStorage.getItem(KEY) || '';

  function normalizeToken(raw) {
    var t = String(raw || '').trim();
    if (t.toLowerCase().indexOf('bearer ') === 0) t = t.slice(7).trim();
    return t;
  }

  function token() {
    var t = normalizeToken(tokenEl.value);
    sessionStorage.setItem(KEY, t);
    tokenEl.value = t;
    return t;
  }

  function showErr(msg) {
    if (!msg) {
      statusEl.className = 'err';
      statusEl.textContent = '';
      return;
    }
    statusEl.className = 'err visible';
    statusEl.textContent = msg;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function api(path, opts) {
    opts = opts || {};
    var t = token();
    if (!t) return Promise.reject(new Error('Colle un accessToken ADMIN puis clique Rafraîchir.'));
    var headers = {
      'Authorization': 'Bearer ' + t,
      'Accept': 'application/json'
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body || undefined
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          var detail = res.status + ' ' + res.statusText;
          if (j && j.message) {
            detail = Array.isArray(j.message) ? j.message.join(', ') : j.message;
          }
          if (res.status === 401) detail = 'Token invalide ou expiré — reconnecte-toi (POST /auth/login).';
          if (res.status === 403) detail = 'Compte non ADMIN (403).';
          throw new Error(detail);
        });
      }
      if (res.status === 204) return null;
      return res.json();
    });
  }

  function fmtTtl(sec) {
    if (sec == null) return '-';
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + 'm ' + s + 's';
  }

  function renderLocks(data) {
    var locks = (data && data.locks) || [];
    if (!locks.length) {
      locksEl.innerHTML = '<p class="empty">Aucun compte verrouillé.</p>';
      return;
    }
    locksEl.innerHTML = '<table><thead><tr><th>Login</th><th>TTL</th><th>Fails</th><th></th></tr></thead><tbody>' +
      locks.map(function (l) {
        return '<tr><td><code>' + escapeHtml(l.loginNormalized) + '</code></td><td>' +
          fmtTtl(l.ttlSeconds) + '</td><td>' + (l.failCount == null ? '-' : l.failCount) +
          '</td><td><button type="button" class="danger" data-unlock="' +
          escapeAttr(l.loginNormalized) + '">Débloquer</button></td></tr>';
      }).join('') + '</tbody></table>';

    Array.prototype.forEach.call(locksEl.querySelectorAll('[data-unlock]'), function (btn) {
      btn.addEventListener('click', function () {
        var login = btn.getAttribute('data-unlock');
        showErr('');
        api('/moderation/login-unlock', {
          method: 'POST',
          body: JSON.stringify({ login: login })
        }).then(function () { return loadAll(); })
          .catch(function (e) { showErr(e.message || String(e)); });
      });
    });
  }

  function renderAttempts(data) {
    var items = (data && data.items) || [];
    if (!items.length) {
      attemptsEl.innerHTML = '<p class="empty">Aucune tentative (essaie filtre « Tous », login vide).</p>';
      return;
    }
    attemptsEl.innerHTML = '<table><thead><tr><th>Quand</th><th>Login</th><th>Résultat</th><th>IP</th></tr></thead><tbody>' +
      items.map(function (a) {
        var cls = a.success ? 'ok' : 'bad';
        var label = a.success ? 'OK' : (a.reason || 'FAIL');
        return '<tr><td>' + escapeHtml(new Date(a.createdAt).toLocaleString('fr-FR')) +
          '</td><td><code>' + escapeHtml(a.loginNormalized) + '</code></td><td><span class="pill ' +
          cls + '">' + escapeHtml(label) + '</span></td><td>' + escapeHtml(a.ip || '-') +
          '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function loadAll() {
    showErr('');
    locksEl.innerHTML = '<p class="empty">Chargement…</p>';
    attemptsEl.innerHTML = '<p class="empty">Chargement…</p>';
    refreshBtn.disabled = true;

    var success = document.getElementById('success').value;
    var login = document.getElementById('loginFilter').value.trim();
    var qs = new URLSearchParams();
    qs.set('limit', '50');
    if (success !== '') qs.set('success', success);
    if (login) qs.set('login', login);

    // Chargements indépendants : un échec n’empêche pas l’autre panneau
    return Promise.all([
      api('/moderation/login-locks')
        .then(function (data) { renderLocks(data); })
        .catch(function (e) {
          locksEl.innerHTML = '<p class="empty">Erreur locks : ' + escapeHtml(e.message) + '</p>';
          throw e;
        }),
      api('/moderation/login-attempts?' + qs.toString())
        .then(function (data) { renderAttempts(data); })
        .catch(function (e) {
          attemptsEl.innerHTML = '<p class="empty">Erreur journal : ' + escapeHtml(e.message) + '</p>';
          throw e;
        })
    ]).then(function () {
      showErr('');
    }).catch(function (e) {
      showErr(e.message || String(e));
    }).then(function () {
      refreshBtn.disabled = false;
    });
  }

  refreshBtn.addEventListener('click', function () { loadAll(); });
  tokenEl.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') loadAll();
  });

  if (tokenEl.value) {
    loadAll();
  }
})();
  </script>
</body>
</html>`;
}
