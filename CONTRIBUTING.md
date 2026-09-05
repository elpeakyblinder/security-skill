# Contribuir a Security Regression Guard

Las contribuciones son bienvenidas: correcciones, ejemplos reproducibles, traducciones, documentación y revisiones de PR. Puedes participar sin acceso de escritura al repositorio: crea un fork y propone tus cambios mediante una pull request hacia `main`.

Aceptamos issues y PR en **español o inglés**. / **Issues and pull requests in Spanish or English are welcome.**

## Elige cómo participar

| Quieres… | Empieza por… |
| --- | --- |
| Reportar una instrucción ambigua o un resultado incorrecto | [Abrir una issue](https://github.com/elpeakyblinder/security-skill/issues/new/choose) con un caso sintético |
| Proponer una nueva comprobación o traducción | Explicar su utilidad en una issue; para cambios pequeños puedes abrir directamente una PR |
| Corregir una errata o un enlace | Editar el archivo y enviar una PR breve |
| Revisar una propuesta | Comentar en una [PR abierta](https://github.com/elpeakyblinder/security-skill/pulls), distinguiendo evidencia y opinión |
| Reportar algo que expone datos o sistemas reales | Seguir [SECURITY.md](SECURITY.md), sin publicar detalles sensibles |

## Preparar una pull request

1. Lee la [skill](security-regression-guard/SKILL.md), la [licencia](LICENSE) y esta guía.
2. Crea un fork en tu cuenta y una rama para tu cambio. Puedes usar el editor web de GitHub para correcciones pequeñas; clonar es opcional.
3. Mantén la propuesta centrada en un problema. No conviertas la regla de un proyecto particular en una obligación para todos.
4. Si cambias instrucciones, edita `security-regression-guard/SKILL.md` y sincroniza `skillSecurity.md`. Ambas copias deben conservar el mismo contenido.
5. Actualiza la documentación afectada y sus traducciones. Añade cambios de comportamiento a la sección «Sin publicar» de [CHANGELOG.md](CHANGELOG.md). Una errata no necesita una batería de pruebas.
6. Abre la PR contra `main`, completa la plantilla y responde a la revisión. Guijosa Dev decide qué se integra; enviar una PR no garantiza su aceptación ni un plazo de respuesta.

No necesitas instalar la skill globalmente para contribuir. Los cambios de versión y las etiquetas los prepara el mantenedor al publicar.

## Evidencia proporcional al cambio

Para una corrección de comportamiento, incluye un ejemplo mínimo y anonimizado: petición del usuario, contexto relevante, decisión observada y decisión esperada. Si probaste con un agente, indica su versión, modelo, fecha y resultado real; si no, dilo. No presentes una revisión de texto como una ejecución comprobada.

Comprueba que las instrucciones preservan la autorización del usuario, no ocultan efectos secundarios y piden pruebas tanto del caso rechazado como del permitido cuando corresponda. Revisa enlaces y formato de los documentos modificados.

Si usaste IA para preparar la contribución, revisa personalmente el resultado y explica las limitaciones relevantes. No adjuntes conversaciones completas, credenciales ni datos de clientes. No se admiten instrucciones ocultas que amplíen permisos, exfiltren información o hagan ejecutar acciones ajenas al objetivo de la skill.

## Idiomas

- `README.md` es la referencia en español y `README.en.md` su traducción al inglés.
- La skill instalable está escrita en español. Traducir el README no significa que exista una segunda skill en inglés ni acredita su rendimiento en ese idioma.
- Para otro idioma, propone `README.<código>.md`, conserva los avisos legales y añade la navegación cuando la traducción esté completa y revisada.
- Si no puedes actualizar una traducción existente, indícalo en la PR para coordinar su revisión antes de integrarla. No inventes compatibilidades ni certificaciones.

## Autoría y licencia de las aportaciones

Para incorporar texto al repositorio, confirma en la PR que tienes los derechos necesarios y que lo ofreces bajo **CC BY-NC 4.0**, la [licencia pública del proyecto](LICENSE). Si tu empleador u otra persona tiene derechos sobre el material, obtén la autorización correspondiente e identifica cualquier contenido de terceros.

Conservas la autoría de tu aportación. **Esta confirmación no transfiere tu copyright ni concede por sí misma permisos comerciales adicionales a Guijosa Dev.** Una eventual incorporación comercial de contenido aportado por terceros requiere acordar esos permisos con sus titulares. No hay reparto de ingresos, pago por contribución ni cesión automática por abrir una PR.

Actualmente no hay un CLA comercial ni un bot de firma configurado. Cualquier acuerdo adicional se propondrá por separado y de forma explícita; no se presume por utilizar GitHub. Estas reglas de recepción de aportaciones no modifican los derechos concedidos por la licencia sobre el material ya publicado.

## Convivencia y revisión

Debate las propuestas con respeto y aporta razones concretas. No se permiten acoso, discriminación, amenazas, spam ni divulgación de datos privados. El mantenedor puede pedir cambios, cerrar propuestas o limitar interacciones abusivas. Para comunicar un problema de conducta de forma privada: [devcharlying@gmail.com](mailto:devcharlying@gmail.com).

La revisión comunitaria ayuda a mejorar el material, pero no constituye una certificación de seguridad. Consulta el [aviso de responsabilidad](README.md#aviso-de-responsabilidad).
