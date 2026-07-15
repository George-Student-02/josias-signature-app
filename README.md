# Contract Signature App

Upload a contract, then collect name / ID number / signature entries against it from any phone.

## Setup (one-time)

### 1. Supabase (storage)

Create a free project at supabase.com, then in the SQL editor run:

```sql
create table contracts (
  id uuid primary key,
  title text not null,
  original_name text not null,
  storage_path text not null,
  mime_type text not null,
  uploaded_at timestamptz not null default now()
);

create table entries (
  id uuid primary key,
  contract_id uuid not null references contracts(id) on delete cascade,
  name text not null,
  id_number text not null,
  signature text not null,
  created_at timestamptz not null default now()
);

alter table contracts enable row level security;
alter table entries enable row level security;
```

Then go to **Storage** and create a new bucket named `contracts` with **Public bucket** turned **off**.

Get your keys from **Project Settings > API**:
- `SUPABASE_URL` — the Project URL
- `SUPABASE_SERVICE_KEY` — the `service_role` secret key (never expose this to the browser)

### 2. Render (hosting)

Push this repo to GitHub, then in Render: **New > Blueprint**, point it at the repo (it reads `render.yaml` automatically). When prompted, fill in:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `APP_PASSWORD` — the password you'll use to log into the app

`SESSION_SECRET` is generated automatically.

## Local development

```
cp .env.example .env   # fill in the values
npm install
npm start
```
