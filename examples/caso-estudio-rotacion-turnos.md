# Caso de Estudio Real: Blindaje y Auditoría de Seguridad en un Módulo de Turnos Rolados

> **Validación práctica en producción asistida por IA**  
> **Autor:** Guijosa Dev  
> **Entorno:** Laravel 10 / PHP 8.2+ / TypeScript / MySQL  
> **Herramienta:** Google Antigravity (Modelo con razonamiento extendido / 3.8 Flash High)  
> **Skill aplicada:** [`security-regression-guard`](../security-regression-guard/SKILL.md)

---

## 1. Resumen Ejecutivo

Este caso de estudio documenta un ciclo de desarrollo real donde se solicitó a un agente de inteligencia artificial implementar un módulo empresarial complejo (**Turnos Rolados / Rotaciones de Turno**) en un sistema multi-tenant de control de asistencia.

El agente generó inicialmente una implementación completa que superaba las pruebas funcionales para los casos previstos. Sin embargo, al activar la skill **`security-regression-guard`**, el agente identificó cuatro omisiones de seguridad relevantes en las fronteras de autorización y validación:

1. **Autorización ausente en consulta:** Acceso a una ruta JSON de previsualización (`preview`) sin comprobar la capacidad correspondiente.
2. **Fuga de información y vector de enumeración multi-tenant (IDOR):** Responder con `403` en lugar de `404` ante recursos de otras empresas, permitiendo inferir la existencia de identificadores ajenos.
3. **Consumo no acotado (DoS):** Ausencia de límites superiores en arrays de entrada (`steps`).
4. **Parámetro fuera de rango:** Falta de validación del paso inicial frente a la cantidad real de turnos en la rotación.

Guiado por las instrucciones de la skill, el agente refactorizó los controladores, solicitudes de formulario (*FormRequests*) e implementó **11 pruebas automatizadas de comportamiento y anti-regresión** que verificaron el rechazo explícito de peticiones no autorizadas o mal formadas.

---

## 2. Escenario inicial: funcionalidad frente a fronteras de seguridad

### Petición original
Se solicitó al agente desarrollar un sistema de turnos rotativos para colaboradores:
- Esquemas cíclicos semanales o diarios (ej. alternancia entre turnos matutinos, vespertinos y nocturnos).
- Soporte para cuadrillas con desfases temporales.
- Proyección cronológica de secuencias futuras y previsualización.
- Asignación masiva por departamento, sede, tipo de contratación o empleado individual.

### Implementación generada
El agente implementó:
- Migraciones de base de datos (`schedule_rotations`, `schedule_rotation_steps`).
- Modelos Eloquent con relaciones y conversiones de tipos.
- Un servicio resolutor cronológico (`ScheduleRotationResolver`).
- Integración en `ScheduleAssignmentManager` para aplicar la rotación a los colaboradores.
- Controlador REST (`ScheduleRotationsController`) con métodos `store`, `update`, `preview`, `assign` y `archive`.
- Vistas Blade y componentes interactivos en TypeScript.

A nivel funcional, el código ejecutaba las operaciones previstas y superaba los casos de prueba positivos. Sin embargo, el modelo priorizó la funcionalidad visible y omitió comprobaciones defensivas en las fronteras de autorización y validación.

---

## 3. La Intervención con `security-regression-guard`

El desarrollador invocó la skill directamente en la conversación:

```text
/security-regression-guard Bien, usa esta skill para el modulo nuevo de rotaciones de turno porfa
```

Al recibir la instrucción, el agente cambió su comportamiento: en lugar de continuar añadiendo funciones o interfaces cosméticas, aplicó la metodología estricta de la skill:

1. **Traza completa de la operación:** Inspeccionar `Ruta -> Middleware -> Validación -> Autorización -> Servicio -> DB -> Respuesta`.
2. **Verificación de permisos por endpoint:** Comprobar que cada acción tenga su capacidad RBAC (`schedules-add`, `schedules-edit`, `schedules-archive`, `schedules`).
3. **Aislamiento Multi-Tenant (Anti-IDOR):** Garantizar que ningún usuario pueda manipular o inferir la existencia de recursos de otra organización.
4. **Validación relacional de claves foráneas:** Asegurar que los IDs anidados (horarios de trabajo asignados en los pasos) pertenezcan a la misma empresa.
5. **Límites de consumo y prevención de DoS:** Acotar matrices y campos numéricos.
6. **Construcción de pruebas de rechazo explícito:** Probar que los atacantes reciben códigos de error estandarizados (`403`, `404`, `422`) sin efectos colaterales en la base de datos.

---

## 4. Hallazgos Concretos y Mitigaciones Aplicadas

### Hallazgo 1: Omisión de Permiso en Endpoint de Consulta (`preview`)
- **Problema:** El método `preview()` en `ScheduleRotationsController` recibía el ID de la rotación y calculaba la línea de tiempo. Sin embargo, no verificaba el permiso `schedules`. Un usuario con credenciales válidas en la aplicación pero sin acceso al módulo de turnos (por ejemplo, un empleado con rol restringido) podía consultar proyecciones internas.
- **Mitigación:** Se incorporó la comprobación antes de cualquier cálculo:
  ```php
  if (permission::permitted('schedules') === 'fail') {
      abort(403, 'Acción no autorizada.');
  }
  ```

### Hallazgo 2: Fuga de Información y Enumeración Multi-Tenant (Anti-IDOR: 403 vs 404)
- **Problema:** En las rutas de `update`, `preview`, `archive` y `assign`, cuando la rotación consultada pertenecía a otra organización, el controlador respondía con `403 Forbidden` (`Acción no autorizada`).
- **Impacto de Seguridad:** En un entorno SaaS multi-tenant, devolver `403` para recursos de otra empresa y `404` para recursos inexistentes permite a un atacante **escanear secuencialmente los IDs** (`/schedules/rotations/1`, `/2`, `/3`...) y descubrir con exactitud qué IDs existen en otras empresas del sistema.
- **Mitigación:** Se reemplazó la respuesta por una verificación de pertenencia estricta (`assertOrganization`) que devuelve `404 Not Found`:
  ```php
  private function assertOrganization(ScheduleRotation $rotation, int|string $organizationId): void
  {
      abort_unless((int) $rotation->organization_id === (int) $organizationId, 404);
  }
  ```
  De este modo, los recursos ajenos resultan indistinguibles de recursos inexistentes.

### Hallazgo 3: Denegación de Servicio (DoS) por Matriz No Acotada
- **Problema:** En `StoreScheduleRotationRequest`, la regla para los pasos era `'steps' => ['required', 'array', 'min:2']`. No existía límite superior. Un payload malicioso con miles de elementos forzaría a la base de datos a ejecutar miles de `INSERT` dentro de una transacción bloqueante. Además, `duration_value` carecía de límites numéricos.
- **Mitigación:** Se acotó el payload estrictamente:
  ```php
  'steps' => ['required', 'array', 'min:2', 'max:20'],
  'steps.*.step_order' => ['required', 'integer', 'min:1', 'max:20'],
  'steps.*.duration_value' => ['nullable', 'integer', 'min:1', 'max:52'],
  ```

### Hallazgo 4: Desbordamiento en Paso Inicial de Asignación
- **Problema:** Al asignar una rotación a un departamento o colaborador, se solicitaba `rotation_initial_step` con regla `'min:1'`. Si la rotación tenía solo 2 turnos (Paso 1 y Paso 2) y se enviaba `rotation_initial_step = 8`, la fórmula matemática de resolución de turnos generaba inconsistencias cronológicas en el historial del empleado.
- **Mitigación:** Se condicionó dinámicamente el valor máximo admisible contra el conteo real de pasos de la rotación:
  ```php
  $maxSteps = max(1, $scheduleRotation->steps()->count());
  $validated = $request->validate([
      ...
      'rotation_initial_step' => ['nullable', 'integer', 'min:1', 'max:'.$maxSteps],
  ]);
  ```

---

## 5. La Matriz de Evidencia y Pruebas Anti-Regresión

Siguiendo el principio de **"Política, código y evidencia"**, el agente diseñó e implementó pruebas de integración en `ScheduleRotationsControllerTest` orientadas a verificar los límites defensivos:

| Test Implementado | Vector Verificado | Resultado Esperado |
| :--- | :--- | :--- |
| `test_unauthorized_user_cannot_preview_rotation` | Solicitud de previsualización sin permiso `schedules` | Rechazo inmediato con `403 Forbidden` |
| `test_unauthorized_user_cannot_archive_rotation` | Intento de archivo sin permiso `schedules-archive` | Rechazo inmediato con `403 Forbidden` |
| `test_cross_tenant_rotation_access_returns_404` | Acceso a `preview`, `update`, `archive` y `assign` con ID de otra organización | Rechazo con `404 Not Found` (Anti-IDOR) en todas las rutas |
| `test_cannot_create_rotation_with_foreign_organization_schedule` | Creación de rotación referenciando un horario de otra empresa | Error de validación `422` en `steps.*.work_schedule_id` |
| `test_cannot_create_rotation_exceeding_max_steps` | Envío de payload con 21 pasos (intento de saturación DoS) | Error de validación `422` en `steps` |
| `test_cannot_assign_initial_step_greater_than_total_steps` | Asignación con paso inicial superior al total de pasos configurados | Error de validación `422` en `rotation_initial_step` |

### Ejecución de Pruebas
```text
PASS Tests\Feature\Admin\ScheduleRotationsControllerTest
  ✓ store creates rotation with steps                                    0.32s
  ✓ update modifies rotation and replaces steps                          0.05s
  ✓ preview returns timeline json                                        0.05s
  ✓ assign creates assignment with initial step                          0.06s
  ✓ archive updates status to archived                                   0.04s
  ✓ unauthorized user cannot preview rotation                            0.05s
  ✓ unauthorized user cannot archive rotation                            0.10s
  ✓ cross tenant rotation access returns 404                             0.09s
  ✓ cannot create rotation with foreign organization schedule            0.05s
  ✓ cannot create rotation exceeding max steps                           0.06s
  ✓ cannot assign initial step greater than total steps                  0.06s

Tests: 11 passed (42 assertions)
Dominio de Horarios: 67 passed (408 assertions, 0 regresiones)
```

---

## 6. Conclusiones y observaciones

1. **Priorización del flujo nominal en modelos generativos:** Los modelos de IA tienden a optimizar la respuesta para satisfacer los requisitos funcionales inmediatos. En ausencia de directivas específicas, asumen entradas benignas y omiten verificaciones de autorización defensivas.
2. **Método determinista frente a peticiones genéricas:** Pedir a un modelo que «haga el código seguro» suele producir cambios superficiales. Una skill estructurada impone una verificación sistemática de rutas, pertenencia de datos, límites de consumo y pruebas de rechazo explícito.
3. **Prevención temprana de regresiones:** Detectar y corregir estas cuatro brechas en la misma sesión evitó desplegar fallos de autorización y vectores de enumeración en entornos compartidos.
