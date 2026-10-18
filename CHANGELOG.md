# Historial de cambios / Changelog

Los números identifican versiones del contenido; no representan una certificación de seguridad. `main` puede contener cambios posteriores a una etiqueta. Consulta las [releases publicadas](https://github.com/elpeakyblinder/security-skill/releases) para descargar una versión concreta.

## Sin publicar / Unreleased

### Añadido / Added

- Caso de estudio real de validación práctica (`examples/caso-estudio-rotacion-turnos.md` y `examples/case-study-shift-rotations.md`), documentando la detección y corrección de 4 vulnerabilidades críticas en un módulo empresarial multi-tenant con un agente de IA.
- Caso de estudio real de autenticación, ciclo de sesión y control de roles en aplicación de escritorio (`examples/caso-estudio-autenticacion-pos.md` y `examples/case-study-pos-authentication.md`), documentando la auditoría y blindaje de 7 hallazgos (cuentas inactivas, timing attacks, DoS, enumeración, revocación en caliente, defensa en profundidad y contención de ventanas) en Python/PyQt6 con SQLite y MySQL.
- Caso de estudio real de auditoría y blindaje de un chatbot con IA y flujo transaccional (`examples/caso-estudio-chatbot-ia.md` y `examples/case-study-ai-chatbot.md`), documentando la prevención de DoS, relevo no autenticado de correos, suplantación de roles, paridad de validación en rutas alternativas e inyección CRLF en Astro, TypeScript, Groq y Resend.
- Caso de estudio real de blindaje de sesión, login y perímetro en una consola administrativa de licencias (`examples/caso-estudio-consola-licencias.md` y `examples/case-study-licensing-console.md`), documentando 5 hallazgos sobre protecciones ya presentes (límite de login evadible por cabecera, logout sin revocación, rotación de contraseña sin efecto, sonda pública costosa y SPA sin cabeceras) en Hono, TypeScript, Neon, Vercel y Cloudflare Workers.
- Enlaces y secciones de caso de estudio en `README.md` y `README.en.md`.
- Refuerzo de `security-regression-guard/SKILL.md` y `skillSecurity.md`: descripción enriquecida para activación semántica, modos explícitos de operación (auditoría de solo lectura, corrección y revisión de diff), mapa rápido por frontera y cobertura ampliada para flujos con IA/LLMs, prevención de *Spam Relay* e inyección CRLF, webhooks entrantes, condiciones de carrera (TOCTOU), políticas RLS/Server Actions, anti-enumeración multi-tenant (`404` frente a `403`), revocación de sesión al rotar contraseña o dar de baja cuentas, cierre de subventanas en escritorio y cabeceras de seguridad en el origen HTML/SPA.
- Suite automatizada en Node.js (`tests/skill.test.mjs`) ampliada a 10 pruebas para validar el empaquetado autocontenido, enlaces, portadas, copias sincronizadas, frontmatter (incluyendo descripciones YAML de una o varias líneas), secciones estructurales obligatorias, saltos de línea `LF`, paridad de casos de estudio bilingües, versión y bloques de código del repositorio.
- Indicador de pruebas y comandos de validación en ambos README, junto con instrucciones para contribución y publicación.

English summary: added practical validation case studies (multi-tenant Laravel shift rotations, Python/PyQt6 desktop POS authentication, session lifecycle, and access control, Astro/TypeScript AI chatbot with transactional email hardening, and Hono/TypeScript licensing admin console session, login, and perimeter hardening), expanded `SKILL.md` with explicit operating modes, boundary routing map, and security guidance for AI/LLM endpoints, CRLF/spam relay prevention, webhooks, TOCTOU concurrency, RLS/Server Actions, cross-tenant anti-enumeration, session revocation on password rotation, desktop subwindow cleanup, and SPA HTML security headers, plus an expanded 10-test Node.js validation suite.

## 0.1.0 — 2026-09-05

### Añadido / Added

- Skill generalista sobre autorización, alcance de datos, operaciones sensibles, archivos, sesiones, límites de consumo y pruebas de regresión.
- Instalación mediante Skills CLI y rutas manuales para Codex, Claude Code, Antigravity y Cursor.
- README en español e inglés, guía de contribución, política de reportes sensibles y plantillas de issues y PR.
- Versionado inicial y guía para mantener el historial y las traducciones.
- Licencia CC BY-NC 4.0, contacto comercial y avisos de responsabilidad y supervisión del usuario.

English summary: initial instruction-only skill, CLI/manual installation guidance, Spanish and English READMEs, contribution and security reporting guides, issue/PR templates, versioning and licensing notices.

### Validación y límites / Validation and limits

La cabecera de la skill y las copias sincronizadas se validaron localmente. Las rutas de instalación se contrastaron con documentación oficial. No se ha realizado una evaluación completa de eficacia en todos los agentes o modelos; la versión no garantiza seguridad de ningún proyecto.

Skill metadata and matching copies were checked locally. Installation paths were checked against official documentation. No comprehensive evaluation across all agents or models has been performed.
