# OpenClaw Private Backup, alcance y recuperación

Este repositorio privado guarda la parte lógica y operativa del proyecto para recuperación rápida en otra máquina.

## Qué sí está respaldado aquí

Este repo incluye, en general:

- código y scripts del workspace
- skills
- reglas operativas
- memoria versionable del workspace
- lógica legal y utilitarios
- estructura del proyecto
- dependencias declaradas (`package.json`, `package-lock.json`)

Ejemplos relevantes:

- `legal-counsel/`
- `scripts/`
- `downloads/google-drive-folder/`
- `memory/`
- `AGENTS.md`
- `USER.md`
- `TOOLS.md`
- `SOUL.md`
- `IDENTITY.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`

## Qué NO está respaldado aquí

Este repo no contiene todavía la recuperación completa de producción.

Quedaron fuera a propósito:

- evidencia de usuarios (`evidence/`)
- documentos generados y salidas (`outputs/slack-documents/`, `outputs/document-tests/`)
- dependencias instaladas localmente (`node_modules/`)
- corpora pesados y dumps temporales
- configuración global fuera del workspace
- sesiones internas, colas y logs runtime

## Qué falta respaldar en otros repos o backups

Para una recuperación total en otra máquina, además de este repo, falta respaldar:

### 1. Configuración global de OpenClaw

Pendiente:

- `/root/.openclaw/openclaw.json`
- otros respaldos útiles de configuración global
- variables sensibles, tokens y secretos en bóveda segura o repo separado cifrado

### 2. Base Qdrant

Pendiente:

- `/root/.openclaw/qdrant/storage/`

Esto es importante porque aquí viven colecciones, embeddings y parte crítica de la operación semántica.

### 3. Evidencia y documentos físicos/digitales de usuarios

Pendiente, con estrategia separada:

- `evidence/`
- originales
- texto extraído limpio
- metadatos
- exportaciones ligadas a causas o clientes

## Qué pasa si la máquina muere hoy

Con este repo ya es posible una recuperación rápida del sistema lógico.

En la práctica, esto permite recuperar rápido:

- skills
- reglas
- memoria operativa del workspace
- scripts
- lógica jurídica
- utilitarios y helpers
- estructura del proyecto

Pero no permite por sí solo levantar toda la producción exactamente como estaba.

## Resumen ejecutivo

### Sí permite

- recuperar el cerebro del proyecto
- reinstalar el workspace en otra máquina
- volver a montar la lógica y los flujos principales con rapidez

### No permite por sí solo

- restaurar la configuración global exacta del gateway
- recuperar secretos automáticamente
- restaurar Qdrant completo
- recuperar evidencia de clientes
- reconstruir todo el entorno de producción con un solo `git clone`

## Estrategia recomendada de recuperación

La recuperación completa debe dividirse en tres capas.

### Capa 1. Ya resuelta

Este repo privado en GitHub:

- código
- skills
- reglas
- memoria operativa
- scripts
- lógica del sistema

### Capa 2. Pendiente

Backup separado de infraestructura y configuración:

- `openclaw.json`
- secretos y tokens
- Qdrant storage

### Capa 3. Pendiente

Backup separado de evidencia:

- archivos originales
- texto limpio
- metadatos
- estructura por cliente/causa

## Paso a paso para recuperación rápida en otra máquina

### Paso 1. Preparar la nueva máquina

Instalar:

- OpenClaw
- git
- Node.js
- Docker o el mecanismo definido para Qdrant

### Paso 2. Clonar este repositorio

```bash
git clone git@github.com:MiguelLeivaLegua/openclaw-private-backup.git
cd openclaw-private-backup
```

### Paso 3. Instalar dependencias del workspace

```bash
npm install
```

### Paso 4. Restaurar la configuración global de OpenClaw

Esto no está en este repo. Debe restaurarse desde backup separado:

- `/root/.openclaw/openclaw.json`
- secretos/tokens necesarios

### Paso 5. Restaurar o reconstruir Qdrant

Opción A, restauración directa desde backup de storage:

- restaurar `/root/.openclaw/qdrant/storage/`

Opción B, reconstrucción:

- volver a cargar colecciones desde corpus y scripts del repo

### Paso 6. Restaurar evidencia desde backup separado

La evidencia debe volver desde su sistema propio de respaldo.

### Paso 7. Validar operación

Verificar al menos:

- OpenClaw activo
- gateway operativo
- Slack conectado
- Qdrant respondiendo
- skills presentes
- scripts legales funcionando
- rutas críticas del workspace intactas

## Qué repos/backups conviene crear después

### Repo 1, ya creado

- `openclaw-private-backup`
- para código, skills, reglas y memoria operativa

### Repo 2, recomendado

- backup privado de configuración global
- idealmente cifrado o con secretos fuera del repo

### Repo 3, recomendado solo si conviene por tamaño/seguridad

- definiciones operativas de evidencia, manifiestos o metadatos no sensibles
- no necesariamente los archivos probatorios en crudo

## Estado actual

### Ya hecho

- repo privado creado y conectado por SSH
- push exitoso del backup lógico del proyecto
- exclusión de evidencia, outputs y peso innecesario mediante `.gitignore`

### Pendiente

- estrategia de respaldo de `openclaw.json`
- estrategia de respaldo de Qdrant
- estrategia separada para evidencia
- documento de restauración total de producción

## Idea guía

Este repositorio hoy sirve para recuperar rápido la inteligencia operativa del sistema.

No es todavía, por sí solo, un backup total de producción.

La visión correcta es:

- este repo guarda el cerebro
- otros backups guardarán la infraestructura, la base semántica y la evidencia
