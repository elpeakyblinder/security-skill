# Publicar Security Regression Guard

Guía para **Guijosa Dev**. La carpeta está preparada para distribuirse como repositorio de documentación y una skill instalable; no necesita publicar un paquete de software.

## Antes de subirla

- Lee la skill, el README y la licencia. El autor público es **Guijosa Dev** y el contacto comercial es **devcharlying@gmail.com**; ese correo quedará visible en el repositorio.
- Comprueba que tienes los derechos necesarios sobre el material que aportas. Si incorporaste textos de terceros, identifica su procedencia y compatibilidad; una revisión técnica no verifica la titularidad de todos los derechos.
- La licencia elegida es **CC BY-NC 4.0**, con permisos comerciales por separado. No la sustituyas por MIT o Apache al crear el repositorio: cambiaría el esquema que elegiste.
- Revisa los términos con un profesional jurídico antes de depender de ellos para limitar responsabilidad o vender permisos. Un disclaimer no asegura que no puedan reclamarte ni concede inmunidad penal.
- Comprueba que el paquete no contiene datos reales de los proyectos, secretos ni archivos de configuración privados.

## Subir a GitHub

1. El repositorio elegido es **[`elpeakyblinder/security-skill`](https://github.com/elpeakyblinder/security-skill)**.
2. Descripción sugerida: **Skill generalista para revisar autorización, aislamiento de datos y regresiones de seguridad con agentes de IA. CC BY-NC 4.0.**
3. Sube el **contenido** de esta carpeta a la raíz del repositorio: README, LICENSE, PUBLICAR, assets, skillSecurity.md y security-regression-guard. Evita añadir otra carpeta exterior que oculte el README.
4. En la vista previa, comprueba la cabecera, las tablas, los desplegables, los enlaces relativos y el aviso al final. Abre también el archivo instalable.
5. Comprueba que el enlace de atribución y los comandos de instalación del README apuntan a `elpeakyblinder/security-skill`. Actualízalos si cambia el propietario o el nombre del repositorio.
6. Cuando hayas comprobado el paquete, crea una release con una etiqueta como **`v1.0.0`**, describiendo el alcance y lo validado realmente. El ZIP del código fuente permite descargarlo y seguir la instalación manual.

GitHub mantiene guías oficiales para [crear repositorios](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository), [añadir archivos](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository), [gestionar releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) y [licenciar un repositorio](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

## Que otras personas puedan instalarla

Una vez publicado el contenido, comparte este comando:

```bash
npx skills add elpeakyblinder/security-skill --skill security-regression-guard
```

Con pnpm:

```bash
pnpm dlx skills add elpeakyblinder/security-skill --skill security-regression-guard
```

El [CLI de Skills](https://www.skills.sh/docs/cli) obtiene el material de GitHub; no necesitas publicar un paquete propio ni pedir a cada usuario que clone el repositorio manualmente. Mantén `security-regression-guard/SKILL.md` con su cabecera `name` y `description`. Para comprobar su detección remota sin instalarlo, ejecuta `pnpm dlx skills add elpeakyblinder/security-skill --list` después del push. Esta comprobación no equivale a ejecutar la skill dentro de un agente.

El README también contiene las rutas de copia manual para Codex, Claude Code, Google Antigravity y Cursor.

Publicar en GitHub **no la registra automáticamente en los catálogos de los agentes**. Esa distribución es opcional y puede requerir otro formato de paquete y cumplir sus condiciones. La instalación manual documentada no depende de que un catálogo acepte el proyecto o su licencia no comercial.

Antes de anunciar «probada en» un agente, comprueba su detección y ejecución en una tarea aislada, registra versión y fecha y revisa las acciones realizadas. Por ahora se han contrastado rutas y formatos con documentación oficial; eso no constituye una evaluación de eficacia en todos los agentes o modelos.

## Gestionar permisos comerciales

El correo de contacto inicia una conversación; no concede por sí mismo una licencia comercial ni genera cobros. Antes de autorizar un uso, acuerda por escrito al menos las partes, el material y versión, usos permitidos, redistribución, precio y forma de pago, soporte si existe y términos de responsabilidad revisados profesionalmente.

CC BY-NC 4.0 no obliga automáticamente a compartir ganancias. Tampoco puedes retirar a quienes cumplen la licencia los permisos no comerciales ya concedidos. Consulta el [resumen oficial](https://creativecommons.org/licenses/by-nc/4.0/deed.es), el [texto jurídico](https://creativecommons.org/licenses/by-nc/4.0/legalcode.es) y las [preguntas frecuentes de Creative Commons](https://creativecommons.org/faq/) para distinguir la licencia pública de acuerdos comerciales separados.

Si aceptas contribuciones, acuerda los derechos necesarios antes de ofrecerlas comercialmente: no presupongas que recibir una pull request te convierte en titular de su contenido. Los futuros scripts ejecutables requerirán una decisión de licencia apropiada para software; la elección actual está pensada para instrucciones y documentación.

Esta guía es operativa y orientativa; no sustituye asesoría jurídica ni promete protección frente a reclamaciones.
