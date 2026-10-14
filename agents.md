# Context

Aplicație cross-platform de repetiții pentru actori. Arhitectură monorepo gestionată prin pnpm workspaces și Turborepo.

# Tech Stack

- **Shared:** TypeScript, Zod
- **Frontend:** Vue 3 (Composition API), Vite, Pinia, Ionic Vue, Capacitor
- **Backend:** Node.js, Fastify, PostgreSQL (Drizzle ORM), BullMQ, Redis
- **OCR Service:** Python, FastAPI

# Reguli de Generare a Codului

## 1. Single Source of Truth

- Orice model de date, schemă de validare sau tip de interfață comună trebuie definit și exportat exclusiv din `packages/shared`.
- Frontend-ul și backend-ul importă aceste tipuri. Este interzisă duplicarea lor.

## 2. Backend (Fastify)

- Folosește exclusiv `fastify-type-provider-zod` pentru validarea request-urilor și a response-urilor.
- Operațiunile costisitoare (ex: parsare PDF) trebuie delegate către workeri BullMQ. Nu bloca event loop-ul.

## 3. Frontend (Vue 3 + Ionic)

- Scrie componente folosind `<script setup lang="ts">`.
- Păstrează logica de stare în store-urile Pinia, nu în componente.
- Orice interacțiune cu hardware-ul (ex: audio) trebuie pusă în spatele unei interfețe abstracte pentru a permite implementări separate de web și nativ (Capacitor).

## 4. Stil și Structură

- Cod TypeScript strict, fără `any` sau `@ts-ignore` nejustificat.
- Răspunsuri concise, strict la obiect.
- Folosește comentarii `// TODO: [Acțiune clară]` pentru logica de business care trebuie amânată sau decisă ulterior.
