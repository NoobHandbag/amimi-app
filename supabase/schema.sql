


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."ask_select"("q" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r jsonb;
begin
  if q !~* '^\s*select' then raise exception 'solo query SELECT sono consentite'; end if;
  if q ~* ';\s*\S' then raise exception 'una sola query alla volta'; end if;
  if q ~* '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|comment|copy|vacuum|merge|call|do)\M'
    then raise exception 'query non consentita'; end if;
  perform set_config('statement_timeout', '5000', true);
  execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (' || q || ') sub limit 200) t' into r;
  return r;
end $$;


ALTER FUNCTION "public"."ask_select"("q" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."norm_codice"("t" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$ select upper(regexp_replace(coalesce(t,''), '\s+', '_', 'g')) $$;


ALTER FUNCTION "public"."norm_codice"("t" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_health_log"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  delete from health_log where day = current_date and k not like 'ce\_%' and k not like 'sales\_%' and k <> 'shipping_status';
  insert into health_log (day, k, label, n, severity)
    select current_date, k, label, n, severity from v_health;
end; $$;


ALTER FUNCTION "public"."refresh_health_log"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."alert_rules" (
    "metrica" "text" NOT NULL,
    "soglia" numeric NOT NULL,
    "finestra_giorni" integer NOT NULL,
    "severity" "text" NOT NULL,
    "attivo" boolean DEFAULT true NOT NULL,
    "note" "text",
    CONSTRAINT "alert_rules_severity_check" CHECK (("severity" = ANY (ARRAY['error'::"text", 'warn'::"text", 'info'::"text"])))
);


ALTER TABLE "public"."alert_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_config" (
    "id" integer DEFAULT 1 NOT NULL,
    "pin_hash" "text",
    "ai_enabled" boolean DEFAULT false NOT NULL,
    "live_sync_enabled" boolean DEFAULT false NOT NULL,
    "corrections_adopted" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "iva_rate" numeric(6,4) DEFAULT 0.22 NOT NULL,
    "parity_tolerance_cents" integer DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "shopify_token" "text",
    "ai_actions_enabled" boolean DEFAULT false NOT NULL,
    CONSTRAINT "app_config_singleton" CHECK (("id" = 1))
);


ALTER TABLE "public"."app_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_flags" (
    "key" "text" NOT NULL,
    "value" "text"
);


ALTER TABLE "public"."app_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_guides" (
    "id" integer DEFAULT 1 NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_guides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."b2b_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mov_id" "text",
    "data" "date",
    "year" integer,
    "month" integer,
    "codice" "text",
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "quantita" numeric,
    "modello" "text",
    "tipo_movimento" "text",
    "negozio" "text",
    "prezzo_retail" numeric(12,2),
    "perc_negozio" numeric(6,4),
    "retail_tot" numeric(14,2) GENERATED ALWAYS AS ("round"((COALESCE("prezzo_retail", (0)::numeric) * COALESCE("quantita", (0)::numeric)), 2)) STORED,
    "quota_negozio" numeric(14,2) GENERATED ALWAYS AS ("round"(((COALESCE("prezzo_retail", (0)::numeric) * COALESCE("quantita", (0)::numeric)) * COALESCE("perc_negozio", (0)::numeric)), 2)) STORED,
    "incasso_amimi" numeric(14,2) GENERATED ALWAYS AS ("round"(((COALESCE("prezzo_retail", (0)::numeric) * COALESCE("quantita", (0)::numeric)) * ((1)::numeric - COALESCE("perc_negozio", (0)::numeric))), 2)) STORED,
    "cogs" numeric(12,2),
    "stato" "text",
    "note" "text",
    "source" "text" DEFAULT 'etl'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "chi" "text"
);


ALTER TABLE "public"."b2b_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ce_snapshots" (
    "id" bigint NOT NULL,
    "ce" "text" NOT NULL,
    "year" integer NOT NULL,
    "month" integer NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "closed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_by" "text",
    CONSTRAINT "ce_snapshots_ce_check" CHECK (("ce" = ANY (ARRAY['amimi'::"text", 'totale'::"text"])))
);


ALTER TABLE "public"."ce_snapshots" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ce_snapshots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ce_snapshots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ce_snapshots_id_seq" OWNED BY "public"."ce_snapshots"."id";



CREATE TABLE IF NOT EXISTS "public"."ce_totale_manual" (
    "year" integer NOT NULL,
    "month" integer NOT NULL,
    "online_netto" numeric DEFAULT 0,
    "offline_netto" numeric DEFAULT 0,
    "b2b_netto" numeric DEFAULT 0,
    "cogs" numeric DEFAULT 0,
    "packaging" numeric DEFAULT 0,
    "commissioni" numeric DEFAULT 0,
    "logistica_var" numeric DEFAULT 0,
    "resi" numeric DEFAULT 0,
    "salari" numeric DEFAULT 0,
    "tasse" numeric DEFAULT 0,
    "logistica_mag" numeric DEFAULT 0,
    "opex" numeric DEFAULT 0,
    "eventi" numeric DEFAULT 0,
    "marketing" numeric DEFAULT 0,
    "note" "text"
);


ALTER TABLE "public"."ce_totale_manual" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ce_totale_monthly" (
    "year" integer DEFAULT 2026 NOT NULL,
    "month" integer NOT NULL,
    "online_netto" numeric DEFAULT 0 NOT NULL,
    "offline_netto" numeric DEFAULT 0 NOT NULL,
    "lordo" numeric DEFAULT 0 NOT NULL,
    "netto" numeric DEFAULT 0 NOT NULL,
    "mc1" numeric DEFAULT 0 NOT NULL,
    "mc2" numeric DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."ce_totale_monthly" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."change_log" (
    "id" bigint NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tbl" "text" NOT NULL,
    "row_id" "text",
    "op" "text" NOT NULL,
    "before" "jsonb",
    "after" "jsonb",
    "chi" "text",
    "source" "text"
);


ALTER TABLE "public"."change_log" OWNER TO "postgres";


ALTER TABLE "public"."change_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."change_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."counts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ts" timestamp with time zone DEFAULT "now"() NOT NULL,
    "data_conta" "date",
    "codice" "text",
    "modello" "text",
    "variante" "text",
    "contati" numeric,
    "giac_snapshot" numeric,
    "delta" numeric,
    "chi" "text",
    "nota" "text",
    "stato" "text",
    "source" "text" DEFAULT 'app'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cs_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gmail_thread_id" "text" NOT NULL,
    "canale" "text" NOT NULL,
    "customer_email" "text",
    "customer_name" "text",
    "stato" "text" DEFAULT 'da_fare'::"text" NOT NULL,
    "stato_by" "text",
    "stato_at" timestamp with time zone,
    "last_msg_at" timestamp with time zone,
    "last_direction" "text",
    "subject" "text",
    "snippet" "text",
    "order_number" integer,
    "lingua" "text",
    "categoria" "text",
    "categoria_source" "text",
    "categoria_confidence" numeric,
    "urgente" boolean,
    "urgenza_motivo" "text",
    "summary" "text",
    "summary_at" timestamp with time zone,
    "parse_failed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "flags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL
);


ALTER TABLE "public"."cs_conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cs_drafts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "testo" "text",
    "dati_usati" "jsonb",
    "model" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "used" boolean DEFAULT false NOT NULL,
    "edited" boolean DEFAULT false NOT NULL,
    "source" "text" DEFAULT 'app'::"text" NOT NULL
);


ALTER TABLE "public"."cs_drafts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cs_drafts"."source" IS 'app = bozza chiesta da operatrice; eval = generata dall''harness di valutazione (scripts/cs-eval.mjs, brief 29-07)';



CREATE TABLE IF NOT EXISTS "public"."cs_events" (
    "id" bigint NOT NULL,
    "conversation_id" "uuid",
    "azione" "text" NOT NULL,
    "chi" "text",
    "dettaglio" "jsonb",
    "at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cs_events" OWNER TO "postgres";


ALTER TABLE "public"."cs_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."cs_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cs_faq" (
    "id" bigint NOT NULL,
    "tipo" "text" NOT NULL,
    "titolo" "text",
    "testo_it" "text",
    "testo_en" "text",
    "categoria" "text",
    "attiva" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."cs_faq" OWNER TO "postgres";


ALTER TABLE "public"."cs_faq" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."cs_faq_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cs_knowledge" (
    "id" integer NOT NULL,
    "categoria" "text",
    "titolo" "text" NOT NULL,
    "contenuto" "text" NOT NULL,
    "attiva" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cs_knowledge" OWNER TO "postgres";


COMMENT ON TABLE "public"."cs_knowledge" IS 'Conoscenza di casa iniettata nel prompt delle bozze CS (cs-assist v14). categoria NULL = sempre; altrimenti solo sulla categoria (nomi ESATTI del classificatore). Si aggiorna qui, mai hardcoded nel prompt.';



CREATE SEQUENCE IF NOT EXISTS "public"."cs_knowledge_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cs_knowledge_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cs_knowledge_id_seq" OWNED BY "public"."cs_knowledge"."id";



CREATE TABLE IF NOT EXISTS "public"."cs_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gmail_message_id" "text" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "direction" "text" NOT NULL,
    "sent_by" "text",
    "from_email" "text",
    "to_email" "text",
    "sent_at" timestamp with time zone,
    "body_text" "text",
    "is_via_tool" boolean DEFAULT false NOT NULL,
    "form_fields" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "body_clean" "text",
    "reply_to" "text"
);


ALTER TABLE "public"."cs_messages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cs_messages"."body_clean" IS 'Corpo pulito deterministico (cs-sync stripQuoted): solo le parole del mittente, senza citazioni/firma/boilerplate. NULL = fallback su body_text.';


COMMENT ON COLUMN "public"."cs_messages"."reply_to" IS 'Header Reply-To del messaggio Gmail, minuscolo, come arrivato (NULL se assente). Fonte dell''email cliente indipendente dal corpo: sul canale modulo Shopify lo valorizza con l''indirizzo di chi ha compilato, qualunque sia la lingua del template. Usato come ULTIMA risorsa da emailCliente() in cs-send e cs-assist, dopo form_fields.email e from_email, cosi'' non puo'' cambiare un esito gia'' corretto. Popolata all''ingest da cs-sync dal 2026-08-01; lo storico si riempie con l''azione backfill_replyto.';



CREATE TABLE IF NOT EXISTS "public"."cs_sends" (
    "send_key" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "chi" "text",
    "to_email" "text",
    "testo_sha" "text",
    "status" "text" DEFAULT 'sending'::"text" NOT NULL,
    "gmail_message_id" "text",
    "gmail_thread_id" "text",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cs_sends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "year" integer,
    "month" integer,
    "date_reported" "date",
    "date_paid" "date",
    "operazione" "text",
    "costo" numeric(12,2),
    "categoria" "text",
    "sottocategoria" "text",
    "amimi_raw" "text",
    "note" "text",
    "source" "text" DEFAULT 'etl'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "amimi" boolean GENERATED ALWAYS AS (("lower"(TRIM(BOTH FROM COALESCE("amimi_raw", ''::"text"))) = 'si'::"text")) STORED,
    "status" "text" DEFAULT 'approved'::"text" NOT NULL,
    "proposed_by" "text",
    "approved_by" "text",
    "chi" "text",
    "categoria_valid" boolean GENERATED ALWAYS AS (("categoria" = ANY (ARRAY['COGS'::"text", 'LOGISTICA'::"text", 'MARKETING'::"text", 'OPEX'::"text", 'PACKAGING'::"text", 'SALARI'::"text", 'TASSE'::"text", 'EVENTI'::"text"]))) STORED
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gifts_offline" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gift_id" "text",
    "year" integer,
    "month" integer,
    "data" "date",
    "nome" "text",
    "cognome" "text",
    "codice" "text",
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "quantita" numeric,
    "payment_method" "text",
    "prezzo" numeric(12,2),
    "cogs" numeric(12,2),
    "nota" "text",
    "item" "text",
    "variant" "text",
    "kind" "text",
    "source" "text" DEFAULT 'etl'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "chi" "text"
);


ALTER TABLE "public"."gifts_offline" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."health_log" (
    "id" bigint NOT NULL,
    "day" "date" DEFAULT CURRENT_DATE NOT NULL,
    "k" "text" NOT NULL,
    "label" "text",
    "n" integer,
    "severity" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."health_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."health_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."health_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."health_log_id_seq" OWNED BY "public"."health_log"."id";



CREATE TABLE IF NOT EXISTS "public"."loyalty_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shopify_customer_id" "text" NOT NULL,
    "delta" integer NOT NULL,
    "source" "text" NOT NULL,
    "meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."loyalty_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_points" (
    "shopify_customer_id" "text" NOT NULL,
    "points" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."loyalty_points" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meta_ads_daily" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date",
    "campaign_id" "text",
    "campaign_name" "text",
    "campaign_status" "text",
    "campaign_objective" "text",
    "spend" numeric(12,2),
    "impressions" bigint,
    "reach" bigint,
    "frequency" numeric(10,4),
    "clicks" bigint,
    "link_clicks" bigint,
    "ctr" numeric(10,4),
    "cpc" numeric(10,4),
    "cpm" numeric(10,4),
    "landing_page_views" bigint,
    "view_content" bigint,
    "add_to_cart" bigint,
    "initiate_checkout" bigint,
    "add_payment_info" bigint,
    "purchases" bigint,
    "purchase_value" numeric(12,2),
    "cpa" numeric(12,4),
    "roas" numeric(12,4),
    "pulled_at" timestamp with time zone,
    "source" "text" DEFAULT 'etl'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."meta_ads_daily" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mimi_state" (
    "shopify_customer_id" "text" NOT NULL,
    "nanna" boolean DEFAULT false NOT NULL,
    "last_coccola" "date",
    "last_memory" "date",
    "worn" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mimi_state" OWNER TO "postgres";


COMMENT ON TABLE "public"."mimi_state" IS 'Stato Mimi per cliente Shopify (nanna, coccole/memory del giorno, capo indossato). Scritta SOLO dalla edge loyalty-proxy col service_role. Le date last_* sono giorni Europe/Rome, non UTC.';



CREATE TABLE IF NOT EXISTS "public"."models" (
    "model" "text" NOT NULL,
    "model_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"("model", '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "categoria" "text" NOT NULL,
    "product_type" "text",
    "template_suffix" "text",
    "collections" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "models_categoria_check" CHECK (("categoria" = ANY (ARRAY['PELLE'::"text", 'TESSUTO'::"text", 'ACCESSORI'::"text"])))
);


ALTER TABLE "public"."models" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."negozi" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "perc_default" numeric(6,4),
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."negozi" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."non_product_codici" (
    "codice" "text" NOT NULL
);


ALTER TABLE "public"."non_product_codici" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_aliases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shopify_name" "text" NOT NULL,
    "shopify_name_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("shopify_name", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "codice" "text" NOT NULL,
    "source" "text" DEFAULT 'etl'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_aliases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codice" "text" NOT NULL,
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "is_finalized" boolean GENERATED ALWAYS AS (((COALESCE("codice", ''::"text") <> ''::"text") AND ("right"(COALESCE("codice", ''::"text"), 1) <> '_'::"text"))) STORED,
    "model" "text",
    "variant" "text",
    "item" "text",
    "categoria" "text",
    "shopify_name" "text",
    "shopify_sku" "text",
    "retail_price" numeric(12,2),
    "cogs" numeric(12,2),
    "description" "text",
    "seo_title" "text",
    "image_url" "text",
    "status" "text",
    "notes" "text",
    "source" "text" DEFAULT 'etl'::"text",
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "verificato" boolean DEFAULT true NOT NULL,
    "riordino_archiviato" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "id_acquisto" "text",
    "codice" "text",
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "data" "date",
    "tipologia" "text",
    "categoria" "text",
    "item" "text",
    "variant" "text",
    "quantita" numeric,
    "unita_misura" "text",
    "costo_unitario" numeric(12,2),
    "costo_totale" numeric(14,2) GENERATED ALWAYS AS ("round"((COALESCE("quantita", (0)::numeric) * COALESCE("costo_unitario", (0)::numeric)), 2)) STORED,
    "fornitore" "text",
    "online" integer,
    "source" "text" DEFAULT 'etl'::"text",
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "note" "text"
);


ALTER TABLE "public"."purchases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."qromo_sales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "text",
    "sale_id" "text",
    "data" "date",
    "year" integer,
    "month" integer,
    "nome" "text",
    "cognome" "text",
    "codice" "text",
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "item" "text",
    "variant" "text",
    "quantita" numeric,
    "payment_method" "text",
    "prezzo" numeric(12,2),
    "cogs" numeric(12,2),
    "resolver_status" "text",
    "note" "text",
    "source" "text" DEFAULT 'etl'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."qromo_sales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."returns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "data" "date" DEFAULT CURRENT_DATE NOT NULL,
    "year" integer,
    "month" integer,
    "codice" "text" NOT NULL,
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "item" "text",
    "variant" "text",
    "quantita" numeric DEFAULT 1 NOT NULL,
    "canale" "text",
    "importo_rimborsato" numeric DEFAULT 0,
    "rientra_stock" boolean DEFAULT true NOT NULL,
    "motivo" "text",
    "sostituito_con" "text",
    "note" "text",
    "source" "text",
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."returns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shipping_status" (
    "ldv" "text" NOT NULL,
    "order_name" "text" NOT NULL,
    "stato_tws" "text" NOT NULL,
    "stato_raw" "text",
    "shipped_date" "date",
    "seen_delivered_at" "date",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shipping_status" OWNER TO "postgres";


COMMENT ON COLUMN "public"."shipping_status"."seen_delivered_at" IS 'Data (Europe/Rome) in cui il sync ha OSSERVATO il passaggio a CONSEGNATA. NON e'' la data di consegna del corriere: TWS non la espone. NULL quando la riga era gia'' consegnata alla prima osservazione.';



CREATE TABLE IF NOT EXISTS "public"."shopify_catalog" (
    "codice" "text" NOT NULL,
    "handle" "text",
    "on_shopify" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."shopify_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shopify_line_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "text",
    "lineitem_name" "text",
    "codice" "text",
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "resolved" boolean,
    "quantita" numeric,
    "price" numeric(12,2),
    "cogs_snapshot" numeric(12,2),
    "year" integer,
    "month" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shopify_line_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shopify_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "text",
    "order_number" "text",
    "created_at_shop" timestamp with time zone,
    "customer_name" "text",
    "email" "text",
    "financial_status" "text",
    "fulfillment_status" "text",
    "gross_total" numeric(12,2),
    "net_total" numeric(12,2),
    "discount_total" numeric(12,2),
    "shipping_total" numeric(12,2),
    "payment_fees" numeric(12,2),
    "refund_amount" numeric(12,2),
    "free_shipping" boolean,
    "currency" "text",
    "year" integer,
    "month" integer,
    "raw" "jsonb",
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vendor" "text",
    "free_shipping_amt" numeric(12,2),
    "fulfilled_at" timestamp with time zone,
    "discount_codes" "text"
);


ALTER TABLE "public"."shopify_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shopify_stock" (
    "codice" "text" NOT NULL,
    "shopify_qty" numeric,
    "shopify_title" "text",
    "variant_id" "text",
    "inventory_item_id" "text",
    "synced_at" timestamp with time zone DEFAULT "now"(),
    "image_url" "text",
    "inventory_item_ids" "text"[],
    "shopify_status" "text"
);


ALTER TABLE "public"."shopify_stock" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_adjustments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codice" "text" NOT NULL,
    "codice_norm" "text" GENERATED ALWAYS AS ("upper"("regexp_replace"(COALESCE("codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text"))) STORED,
    "qty_delta" numeric NOT NULL,
    "motivo" "text" DEFAULT 'conta'::"text",
    "count_id" "uuid",
    "data" "date" DEFAULT (("now"() AT TIME ZONE 'Europe/Rome'::"text"))::"date",
    "chi" "text",
    "source" "text" DEFAULT 'app'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "return_id" "uuid"
);


ALTER TABLE "public"."stock_adjustments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."stock_adjustments"."return_id" IS 'FK logica a returns.id: aggiustamento generato da un cambio-merce (sostituto uscito); reso reversibile via write-api return_delete';



CREATE TABLE IF NOT EXISTS "public"."supplier_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "codice" "text",
    "item" "text",
    "variant" "text",
    "fornitore" "text",
    "qty_ordered" numeric,
    "qty_arrived" numeric DEFAULT 0 NOT NULL,
    "data_ordine" "date",
    "data_ultimo_arrivo" "date",
    "note" "text",
    "source" "text" DEFAULT 'app'::"text",
    "chi" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gruppo" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nuovo_riordino" "text",
    "costo_unitario" numeric,
    "data_consegna" "date",
    "wip" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."supplier_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "kind" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ads_mensile" AS
 SELECT (EXTRACT(year FROM "date"))::integer AS "year",
    (EXTRACT(month FROM "date"))::integer AS "month",
    "round"("sum"(COALESCE("spend", (0)::numeric)), 2) AS "spend",
    "sum"(COALESCE("impressions", (0)::bigint)) AS "impressions",
    "sum"(COALESCE("clicks", (0)::bigint)) AS "clicks",
    "sum"(COALESCE("purchases", (0)::bigint)) AS "purchases",
    "round"("sum"(COALESCE("purchase_value", (0)::numeric)), 2) AS "purchase_value",
        CASE
            WHEN ("sum"(COALESCE("spend", (0)::numeric)) > (0)::numeric) THEN "round"(("sum"(COALESCE("purchase_value", (0)::numeric)) / "sum"(COALESCE("spend", (0)::numeric))), 2)
            ELSE (0)::numeric
        END AS "roas"
   FROM "public"."meta_ads_daily"
  GROUP BY ((EXTRACT(year FROM "date"))::integer), ((EXTRACT(month FROM "date"))::integer)
  ORDER BY ((EXTRACT(year FROM "date"))::integer), ((EXTRACT(month FROM "date"))::integer);


ALTER VIEW "public"."v_ads_mensile" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ce_amimi" AS
 WITH "periods" AS (
         SELECT DISTINCT "u"."year",
            "u"."month"
           FROM ( SELECT "shopify_orders"."year",
                    "shopify_orders"."month"
                   FROM "public"."shopify_orders"
                  WHERE ("shopify_orders"."year" IS NOT NULL)
                UNION ALL
                 SELECT "qromo_sales"."year",
                    "qromo_sales"."month"
                   FROM "public"."qromo_sales"
                  WHERE ("qromo_sales"."year" IS NOT NULL)
                UNION ALL
                 SELECT "b2b_movements"."year",
                    "b2b_movements"."month"
                   FROM "public"."b2b_movements"
                  WHERE ("b2b_movements"."year" IS NOT NULL)
                UNION ALL
                 SELECT "expenses"."year",
                    "expenses"."month"
                   FROM "public"."expenses"
                  WHERE ("expenses"."year" IS NOT NULL)
                UNION ALL
                 SELECT "returns"."year",
                    "returns"."month"
                   FROM "public"."returns"
                  WHERE ("returns"."year" IS NOT NULL)) "u"
          WHERE (("u"."month" >= 1) AND ("u"."month" <= 12))
        ), "so" AS (
         SELECT "shopify_orders"."year",
            "shopify_orders"."month",
            "count"(*) AS "ordini",
            COALESCE("sum"("shopify_orders"."discount_total"), (0)::numeric) AS "disc",
            COALESCE("sum"("shopify_orders"."free_shipping_amt"), (0)::numeric) AS "freeship",
            COALESCE("sum"("shopify_orders"."shipping_total"), (0)::numeric) AS "sped",
            COALESCE("sum"("shopify_orders"."payment_fees"), (0)::numeric) AS "commissioni",
            COALESCE("sum"("shopify_orders"."refund_amount"), (0)::numeric) AS "refund"
           FROM "public"."shopify_orders"
          GROUP BY "shopify_orders"."year", "shopify_orders"."month"
        ), "sl" AS (
         SELECT "shopify_line_items"."year",
            "shopify_line_items"."month",
            COALESCE("sum"("shopify_line_items"."quantita"), (0)::numeric) AS "pezzi",
            COALESCE("sum"(("shopify_line_items"."price" * "shopify_line_items"."quantita")), (0)::numeric) AS "vendite",
            COALESCE("sum"(("shopify_line_items"."cogs_snapshot" * "shopify_line_items"."quantita")), (0)::numeric) AS "cogs"
           FROM "public"."shopify_line_items"
          GROUP BY "shopify_line_items"."year", "shopify_line_items"."month"
        ), "qr" AS (
         SELECT "qromo_sales"."year",
            "qromo_sales"."month",
            COALESCE("sum"("qromo_sales"."quantita"), (0)::numeric) AS "pezzi",
            COALESCE("sum"("qromo_sales"."prezzo"), (0)::numeric) AS "lordo",
            COALESCE("sum"(("qromo_sales"."cogs" * "qromo_sales"."quantita")), (0)::numeric) AS "cogs"
           FROM "public"."qromo_sales"
          GROUP BY "qromo_sales"."year", "qromo_sales"."month"
        ), "b2" AS (
         SELECT "b2b_movements"."year",
            "b2b_movements"."month",
            COALESCE("sum"("b2b_movements"."quantita") FILTER (WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND (("b2b_movements"."stato" IS NULL) OR ("b2b_movements"."stato" <> 'annullato'::"text")))), (0)::numeric) AS "pezzi",
            COALESCE("sum"("b2b_movements"."incasso_amimi") FILTER (WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND (("b2b_movements"."stato" IS NULL) OR ("b2b_movements"."stato" <> 'annullato'::"text")))), (0)::numeric) AS "lordo",
            COALESCE("sum"("b2b_movements"."cogs") FILTER (WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND (("b2b_movements"."stato" IS NULL) OR ("b2b_movements"."stato" <> 'annullato'::"text")))), (0)::numeric) AS "cogs"
           FROM "public"."b2b_movements"
          GROUP BY "b2b_movements"."year", "b2b_movements"."month"
        ), "ex" AS (
         SELECT "expenses"."year",
            "expenses"."month",
            COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'SALARI'::"text")), (0)::numeric) AS "salari",
            COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'TASSE'::"text")), (0)::numeric) AS "tasse",
            COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'OPEX'::"text")), (0)::numeric) AS "opex",
            COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'EVENTI'::"text")), (0)::numeric) AS "eventi",
            COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'MARKETING'::"text")), (0)::numeric) AS "marketing",
            COALESCE("sum"("expenses"."costo") FILTER (WHERE (("expenses"."categoria" = 'LOGISTICA'::"text") AND ("expenses"."sottocategoria" ~~* 'sped%'::"text"))), (0)::numeric) AS "logistica_var",
            COALESCE("sum"("expenses"."costo") FILTER (WHERE (("expenses"."categoria" = 'LOGISTICA'::"text") AND (("expenses"."sottocategoria" IS NULL) OR ("expenses"."sottocategoria" !~~* 'sped%'::"text")))), (0)::numeric) AS "logistica_mag"
           FROM "public"."expenses"
          WHERE ("expenses"."amimi" AND ("expenses"."status" = 'approved'::"text"))
          GROUP BY "expenses"."year", "expenses"."month"
        ), "qret" AS (
         SELECT "returns"."year",
            "returns"."month",
            COALESCE("sum"("returns"."importo_rimborsato"), (0)::numeric) AS "imp"
           FROM "public"."returns"
          WHERE ("returns"."canale" = 'qromo'::"text")
          GROUP BY "returns"."year", "returns"."month"
        )
 SELECT "p"."year",
    "p"."month",
    (((COALESCE("sl"."vendite", (0)::numeric) - COALESCE("so"."disc", (0)::numeric)) + COALESCE("so"."freeship", (0)::numeric)) + COALESCE("so"."sped", (0)::numeric)) AS "online_lordo",
    ((((COALESCE("sl"."vendite", (0)::numeric) - COALESCE("so"."disc", (0)::numeric)) + COALESCE("so"."freeship", (0)::numeric)) + COALESCE("so"."sped", (0)::numeric)) / 1.22) AS "online_netto",
    COALESCE("sl"."pezzi", (0)::numeric) AS "online_pezzi",
    COALESCE("qr"."lordo", (0)::numeric) AS "offline_lordo",
    (COALESCE("qr"."lordo", (0)::numeric) / 1.22) AS "offline_netto",
    COALESCE("qr"."pezzi", (0)::numeric) AS "offline_pezzi",
    COALESCE("b2"."lordo", (0)::numeric) AS "b2b_lordo",
    (COALESCE("b2"."lordo", (0)::numeric) / 1.22) AS "b2b_netto",
    COALESCE("b2"."pezzi", (0)::numeric) AS "b2b_pezzi",
    ((((((COALESCE("sl"."vendite", (0)::numeric) - COALESCE("so"."disc", (0)::numeric)) + COALESCE("so"."freeship", (0)::numeric)) + COALESCE("so"."sped", (0)::numeric)) / 1.22) + (COALESCE("qr"."lordo", (0)::numeric) / 1.22)) + (COALESCE("b2"."lordo", (0)::numeric) / 1.22)) AS "omni_netto",
    (- ((COALESCE("sl"."cogs", (0)::numeric) + COALESCE("qr"."cogs", (0)::numeric)) + COALESCE("b2"."cogs", (0)::numeric))) AS "cogs",
    (- ((3.71 * (COALESCE("sl"."pezzi", (0)::numeric) + COALESCE("qr"."pezzi", (0)::numeric))) + (COALESCE("so"."ordini", (0)::bigint))::numeric)) AS "packaging",
    COALESCE("so"."commissioni", (0)::numeric) AS "commissioni",
    COALESCE("ex"."logistica_var", (0)::numeric) AS "logistica_var",
    ((- (COALESCE("so"."refund", (0)::numeric) + COALESCE("qret"."imp", (0)::numeric))) / 1.22) AS "resi",
    COALESCE("ex"."salari", (0)::numeric) AS "salari",
    COALESCE("ex"."tasse", (0)::numeric) AS "tasse",
    COALESCE("ex"."logistica_mag", (0)::numeric) AS "logistica_mag",
    COALESCE("ex"."opex", (0)::numeric) AS "opex",
    COALESCE("ex"."eventi", (0)::numeric) AS "eventi",
    COALESCE("ex"."marketing", (0)::numeric) AS "marketing"
   FROM (((((("periods" "p"
     LEFT JOIN "so" ON ((("so"."year" = "p"."year") AND ("so"."month" = "p"."month"))))
     LEFT JOIN "sl" ON ((("sl"."year" = "p"."year") AND ("sl"."month" = "p"."month"))))
     LEFT JOIN "qr" ON ((("qr"."year" = "p"."year") AND ("qr"."month" = "p"."month"))))
     LEFT JOIN "b2" ON ((("b2"."year" = "p"."year") AND ("b2"."month" = "p"."month"))))
     LEFT JOIN "ex" ON ((("ex"."year" = "p"."year") AND ("ex"."month" = "p"."month"))))
     LEFT JOIN "qret" ON ((("qret"."year" = "p"."year") AND ("qret"."month" = "p"."month"))));


ALTER VIEW "public"."v_ce_amimi" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ce_amimi_summary" AS
 SELECT "year",
    "month",
    "online_lordo",
    "online_netto",
    "online_pezzi",
    "offline_lordo",
    "offline_netto",
    "offline_pezzi",
    "b2b_lordo",
    "b2b_netto",
    "b2b_pezzi",
    "omni_netto",
    "cogs",
    "packaging",
    "commissioni",
    "logistica_var",
    "resi",
    "salari",
    "tasse",
    "logistica_mag",
    "opex",
    "eventi",
    "marketing",
    ((((("omni_netto" + "cogs") + "packaging") + "commissioni") + "logistica_var") + "resi") AS "mc1",
    ((((((((((("omni_netto" + "cogs") + "packaging") + "commissioni") + "logistica_var") + "resi") + "salari") + "tasse") + "logistica_mag") + "opex") + "eventi") + "marketing") AS "mc2"
   FROM "public"."v_ce_amimi";


ALTER VIEW "public"."v_ce_amimi_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ce_totale" AS
 SELECT "year",
    "month",
    "online_lordo",
    "online_netto",
    "online_pezzi",
    "offline_lordo",
    "offline_netto",
    "offline_pezzi",
    "b2b_lordo",
    "b2b_netto",
    "b2b_pezzi",
    "omni_netto",
    "cogs",
    "packaging",
    "commissioni",
    "logistica_var",
    "resi",
    "salari",
    "tasse",
    "logistica_mag",
    "opex",
    "eventi",
    "marketing",
    ((((("omni_netto" + "cogs") + "packaging") + "commissioni") + "logistica_var") + "resi") AS "mc1",
    ((((((((((("omni_netto" + "cogs") + "packaging") + "commissioni") + "logistica_var") + "resi") + "salari") + "tasse") + "logistica_mag") + "opex") + "eventi") + "marketing") AS "mc2"
   FROM ( WITH "periods" AS (
                 SELECT DISTINCT "u"."year",
                    "u"."month"
                   FROM ( SELECT "shopify_orders"."year",
                            "shopify_orders"."month"
                           FROM "public"."shopify_orders"
                          WHERE ("shopify_orders"."year" IS NOT NULL)
                        UNION ALL
                         SELECT "qromo_sales"."year",
                            "qromo_sales"."month"
                           FROM "public"."qromo_sales"
                          WHERE ("qromo_sales"."year" IS NOT NULL)
                        UNION ALL
                         SELECT "gifts_offline"."year",
                            "gifts_offline"."month"
                           FROM "public"."gifts_offline"
                          WHERE ("gifts_offline"."year" IS NOT NULL)
                        UNION ALL
                         SELECT "b2b_movements"."year",
                            "b2b_movements"."month"
                           FROM "public"."b2b_movements"
                          WHERE ("b2b_movements"."year" IS NOT NULL)
                        UNION ALL
                         SELECT "expenses"."year",
                            "expenses"."month"
                           FROM "public"."expenses"
                          WHERE ("expenses"."year" IS NOT NULL)
                        UNION ALL
                         SELECT "ce_totale_manual"."year",
                            "ce_totale_manual"."month"
                           FROM "public"."ce_totale_manual"
                          WHERE ("ce_totale_manual"."year" IS NOT NULL)) "u"
                  WHERE (("u"."month" >= 1) AND ("u"."month" <= 12))
                ), "so" AS (
                 SELECT "shopify_orders"."year",
                    "shopify_orders"."month",
                    "count"(*) AS "ordini",
                    COALESCE("sum"("shopify_orders"."discount_total"), (0)::numeric) AS "disc",
                    COALESCE("sum"("shopify_orders"."free_shipping_amt"), (0)::numeric) AS "freeship",
                    COALESCE("sum"("shopify_orders"."shipping_total"), (0)::numeric) AS "sped",
                    COALESCE("sum"("shopify_orders"."payment_fees"), (0)::numeric) AS "commissioni",
                    COALESCE("sum"("shopify_orders"."refund_amount"), (0)::numeric) AS "refund"
                   FROM "public"."shopify_orders"
                  GROUP BY "shopify_orders"."year", "shopify_orders"."month"
                ), "sl" AS (
                 SELECT "shopify_line_items"."year",
                    "shopify_line_items"."month",
                    COALESCE("sum"("shopify_line_items"."quantita"), (0)::numeric) AS "pezzi",
                    COALESCE("sum"(("shopify_line_items"."price" * "shopify_line_items"."quantita")), (0)::numeric) AS "vendite",
                    COALESCE("sum"(("shopify_line_items"."cogs_snapshot" * "shopify_line_items"."quantita")), (0)::numeric) AS "cogs"
                   FROM "public"."shopify_line_items"
                  GROUP BY "shopify_line_items"."year", "shopify_line_items"."month"
                ), "qr" AS (
                 SELECT "qromo_sales"."year",
                    "qromo_sales"."month",
                    COALESCE("sum"("qromo_sales"."quantita"), (0)::numeric) AS "pezzi",
                    COALESCE("sum"("qromo_sales"."prezzo"), (0)::numeric) AS "lordo",
                    COALESCE("sum"(("qromo_sales"."cogs" * "qromo_sales"."quantita")), (0)::numeric) AS "cogs"
                   FROM "public"."qromo_sales"
                  GROUP BY "qromo_sales"."year", "qromo_sales"."month"
                ), "gf" AS (
                 SELECT "gifts_offline"."year",
                    "gifts_offline"."month",
                    COALESCE("sum"("gifts_offline"."quantita"), (0)::numeric) AS "pezzi",
                    COALESCE("sum"("gifts_offline"."prezzo"), (0)::numeric) AS "lordo",
                    COALESCE("sum"("gifts_offline"."cogs"), (0)::numeric) AS "cogs"
                   FROM "public"."gifts_offline"
                  GROUP BY "gifts_offline"."year", "gifts_offline"."month"
                ), "b2" AS (
                 SELECT "b2b_movements"."year",
                    "b2b_movements"."month",
                    COALESCE("sum"("b2b_movements"."quantita") FILTER (WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND (("b2b_movements"."stato" IS NULL) OR ("b2b_movements"."stato" <> 'annullato'::"text")))), (0)::numeric) AS "pezzi",
                    COALESCE("sum"("b2b_movements"."incasso_amimi") FILTER (WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND (("b2b_movements"."stato" IS NULL) OR ("b2b_movements"."stato" <> 'annullato'::"text")))), (0)::numeric) AS "lordo",
                    COALESCE("sum"("b2b_movements"."cogs") FILTER (WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND (("b2b_movements"."stato" IS NULL) OR ("b2b_movements"."stato" <> 'annullato'::"text")))), (0)::numeric) AS "cogs"
                   FROM "public"."b2b_movements"
                  GROUP BY "b2b_movements"."year", "b2b_movements"."month"
                ), "ex" AS (
                 SELECT "expenses"."year",
                    "expenses"."month",
                    COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'SALARI'::"text")), (0)::numeric) AS "salari",
                    COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'TASSE'::"text")), (0)::numeric) AS "tasse",
                    COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'OPEX'::"text")), (0)::numeric) AS "opex",
                    COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'EVENTI'::"text")), (0)::numeric) AS "eventi",
                    COALESCE("sum"("expenses"."costo") FILTER (WHERE ("expenses"."categoria" = 'MARKETING'::"text")), (0)::numeric) AS "marketing",
                    COALESCE("sum"("expenses"."costo") FILTER (WHERE (("expenses"."categoria" = 'LOGISTICA'::"text") AND (("expenses"."sottocategoria" IS NULL) OR ("expenses"."sottocategoria" !~~* 'sped%'::"text")))), (0)::numeric) AS "logistica_mag"
                   FROM "public"."expenses"
                  WHERE ("expenses"."status" = 'approved'::"text")
                  GROUP BY "expenses"."year", "expenses"."month"
                )
         SELECT "p"."year",
            "p"."month",
            (((COALESCE("sl"."vendite", (0)::numeric) - COALESCE("so"."disc", (0)::numeric)) + COALESCE("so"."freeship", (0)::numeric)) + COALESCE("so"."sped", (0)::numeric)) AS "online_lordo",
            (((((COALESCE("sl"."vendite", (0)::numeric) - COALESCE("so"."disc", (0)::numeric)) + COALESCE("so"."freeship", (0)::numeric)) + COALESCE("so"."sped", (0)::numeric)) / 1.22) + COALESCE("m"."online_netto", (0)::numeric)) AS "online_netto",
            COALESCE("sl"."pezzi", (0)::numeric) AS "online_pezzi",
            (COALESCE("qr"."lordo", (0)::numeric) + COALESCE("gf"."lordo", (0)::numeric)) AS "offline_lordo",
            (((COALESCE("qr"."lordo", (0)::numeric) + COALESCE("gf"."lordo", (0)::numeric)) / 1.22) + COALESCE("m"."offline_netto", (0)::numeric)) AS "offline_netto",
            (COALESCE("qr"."pezzi", (0)::numeric) + COALESCE("gf"."pezzi", (0)::numeric)) AS "offline_pezzi",
            COALESCE("b2"."lordo", (0)::numeric) AS "b2b_lordo",
            ((COALESCE("b2"."lordo", (0)::numeric) / 1.22) + COALESCE("m"."b2b_netto", (0)::numeric)) AS "b2b_netto",
            COALESCE("b2"."pezzi", (0)::numeric) AS "b2b_pezzi",
            (((((((((COALESCE("sl"."vendite", (0)::numeric) - COALESCE("so"."disc", (0)::numeric)) + COALESCE("so"."freeship", (0)::numeric)) + COALESCE("so"."sped", (0)::numeric)) / 1.22) + ((COALESCE("qr"."lordo", (0)::numeric) + COALESCE("gf"."lordo", (0)::numeric)) / 1.22)) + (COALESCE("b2"."lordo", (0)::numeric) / 1.22)) + COALESCE("m"."online_netto", (0)::numeric)) + COALESCE("m"."offline_netto", (0)::numeric)) + COALESCE("m"."b2b_netto", (0)::numeric)) AS "omni_netto",
            ((- (((COALESCE("sl"."cogs", (0)::numeric) + COALESCE("qr"."cogs", (0)::numeric)) + COALESCE("gf"."cogs", (0)::numeric)) + COALESCE("b2"."cogs", (0)::numeric))) + COALESCE("m"."cogs", (0)::numeric)) AS "cogs",
            ((- ((3.71 * ((COALESCE("sl"."pezzi", (0)::numeric) + COALESCE("qr"."pezzi", (0)::numeric)) + COALESCE("gf"."pezzi", (0)::numeric))) + (COALESCE("so"."ordini", (0)::bigint))::numeric)) + COALESCE("m"."packaging", (0)::numeric)) AS "packaging",
            (COALESCE("so"."commissioni", (0)::numeric) + COALESCE("m"."commissioni", (0)::numeric)) AS "commissioni",
            COALESCE("m"."logistica_var", (0)::numeric) AS "logistica_var",
            (((- COALESCE("so"."refund", (0)::numeric)) / 1.22) + COALESCE("m"."resi", (0)::numeric)) AS "resi",
            (COALESCE("ex"."salari", (0)::numeric) + COALESCE("m"."salari", (0)::numeric)) AS "salari",
            (COALESCE("ex"."tasse", (0)::numeric) + COALESCE("m"."tasse", (0)::numeric)) AS "tasse",
            (COALESCE("ex"."logistica_mag", (0)::numeric) + COALESCE("m"."logistica_mag", (0)::numeric)) AS "logistica_mag",
            (COALESCE("ex"."opex", (0)::numeric) + COALESCE("m"."opex", (0)::numeric)) AS "opex",
            (COALESCE("ex"."eventi", (0)::numeric) + COALESCE("m"."eventi", (0)::numeric)) AS "eventi",
            (COALESCE("ex"."marketing", (0)::numeric) + COALESCE("m"."marketing", (0)::numeric)) AS "marketing"
           FROM ((((((("periods" "p"
             LEFT JOIN "so" ON ((("so"."year" = "p"."year") AND ("so"."month" = "p"."month"))))
             LEFT JOIN "sl" ON ((("sl"."year" = "p"."year") AND ("sl"."month" = "p"."month"))))
             LEFT JOIN "qr" ON ((("qr"."year" = "p"."year") AND ("qr"."month" = "p"."month"))))
             LEFT JOIN "gf" ON ((("gf"."year" = "p"."year") AND ("gf"."month" = "p"."month"))))
             LEFT JOIN "b2" ON ((("b2"."year" = "p"."year") AND ("b2"."month" = "p"."month"))))
             LEFT JOIN "ex" ON ((("ex"."year" = "p"."year") AND ("ex"."month" = "p"."month"))))
             LEFT JOIN "public"."ce_totale_manual" "m" ON ((("m"."year" = "p"."year") AND ("m"."month" = "p"."month"))))) "f";


ALTER VIEW "public"."v_ce_totale" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ce_drift" AS
 WITH "live" AS (
         SELECT 'amimi'::"text" AS "ce",
            "v_ce_amimi_summary"."year",
            "v_ce_amimi_summary"."month",
            "v_ce_amimi_summary"."omni_netto",
            "v_ce_amimi_summary"."mc1",
            "v_ce_amimi_summary"."mc2"
           FROM "public"."v_ce_amimi_summary"
        UNION ALL
         SELECT 'totale'::"text",
            "v_ce_totale"."year",
            "v_ce_totale"."month",
            "v_ce_totale"."omni_netto",
            "v_ce_totale"."mc1",
            "v_ce_totale"."mc2"
           FROM "public"."v_ce_totale"
        )
 SELECT "s"."ce",
    "s"."year",
    "s"."month",
    "s"."closed_at",
    "s"."closed_by",
    "round"((("s"."snapshot" ->> 'omni_netto'::"text"))::numeric, 2) AS "netto_chiuso",
    "round"("l"."omni_netto", 2) AS "netto_live",
    "round"(("l"."omni_netto" - (("s"."snapshot" ->> 'omni_netto'::"text"))::numeric), 2) AS "delta_netto",
    "round"((("s"."snapshot" ->> 'mc2'::"text"))::numeric, 2) AS "mc2_chiuso",
    "round"("l"."mc2", 2) AS "mc2_live",
    "round"(("l"."mc2" - (("s"."snapshot" ->> 'mc2'::"text"))::numeric), 2) AS "delta_mc2"
   FROM ("public"."ce_snapshots" "s"
     JOIN "live" "l" ON ((("l"."ce" = "s"."ce") AND ("l"."year" = "s"."year") AND ("l"."month" = "s"."month"))));


ALTER VIEW "public"."v_ce_drift" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ce_totale_summary" AS
 SELECT "year",
    "month",
    "online_lordo",
    "online_netto",
    "online_pezzi",
    "offline_lordo",
    "offline_netto",
    "offline_pezzi",
    "b2b_lordo",
    "b2b_netto",
    "b2b_pezzi",
    "omni_netto",
    "cogs",
    "packaging",
    "commissioni",
    "logistica_var",
    "resi",
    "salari",
    "tasse",
    "logistica_mag",
    "opex",
    "eventi",
    "marketing",
    ((((("omni_netto" + "cogs") + "packaging") + "commissioni") + "logistica_var") + "resi") AS "mc1",
    ((((((((((("omni_netto" + "cogs") + "packaging") + "commissioni") + "logistica_var") + "resi") + "salari") + "tasse") + "logistica_mag") + "opex") + "eventi") + "marketing") AS "mc2"
   FROM "public"."v_ce_totale";


ALTER VIEW "public"."v_ce_totale_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_clienti_coorti" AS
 WITH "ord" AS (
         SELECT "lower"("shopify_orders"."email") AS "email",
            "shopify_orders"."created_at_shop",
            "shopify_orders"."gross_total",
            "shopify_orders"."financial_status"
           FROM "public"."shopify_orders"
          WHERE (("shopify_orders"."email" IS NOT NULL) AND ("shopify_orders"."email" <> ''::"text"))
        ), "primo" AS (
         SELECT "ord"."email",
            "min"("ord"."created_at_shop") AS "primo"
           FROM "ord"
          GROUP BY "ord"."email"
        ), "riacquisti" AS (
         SELECT "p"."email",
            ("date_trunc"('month'::"text", "p"."primo"))::"date" AS "coorte",
            "min"("o"."created_at_shop") FILTER (WHERE ("o"."created_at_shop" > "p"."primo")) AS "secondo"
           FROM ("primo" "p"
             JOIN "ord" "o" ON (("o"."email" = "p"."email")))
          GROUP BY "p"."email", "p"."primo"
        ), "mon" AS (
         SELECT "p"."email",
            ("date_trunc"('month'::"text", "p"."primo"))::"date" AS "coorte",
            "sum"("o"."gross_total") FILTER (WHERE ("o"."financial_status" <> 'refunded'::"text")) AS "spesa"
           FROM ("primo" "p"
             JOIN "ord" "o" ON (("o"."email" = "p"."email")))
          GROUP BY "p"."email", (("date_trunc"('month'::"text", "p"."primo"))::"date")
        )
 SELECT "r"."coorte",
    (CURRENT_DATE - "r"."coorte") AS "maturita_giorni",
    "count"(*) AS "clienti",
    "count"(*) FILTER (WHERE (("r"."secondo" IS NOT NULL) AND ("r"."secondo" <= (( SELECT "min"("o2"."created_at_shop") AS "min"
           FROM "ord" "o2"
          WHERE ("o2"."email" = "r"."email")) + '30 days'::interval)))) AS "ricomprato_30gg",
    "count"(*) FILTER (WHERE (("r"."secondo" IS NOT NULL) AND ("r"."secondo" <= (( SELECT "min"("o2"."created_at_shop") AS "min"
           FROM "ord" "o2"
          WHERE ("o2"."email" = "r"."email")) + '60 days'::interval)))) AS "ricomprato_60gg",
    "count"(*) FILTER (WHERE (("r"."secondo" IS NOT NULL) AND ("r"."secondo" <= (( SELECT "min"("o2"."created_at_shop") AS "min"
           FROM "ord" "o2"
          WHERE ("o2"."email" = "r"."email")) + '90 days'::interval)))) AS "ricomprato_90gg",
    "round"("avg"("m"."spesa"), 2) AS "netto_medio_cliente"
   FROM ("riacquisti" "r"
     JOIN "mon" "m" ON (("m"."email" = "r"."email")))
  GROUP BY "r"."coorte"
  ORDER BY "r"."coorte";


ALTER VIEW "public"."v_clienti_coorti" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_clienti_rfm" AS
 WITH "ord" AS (
         SELECT "lower"("shopify_orders"."email") AS "email",
            "shopify_orders"."order_number",
            "shopify_orders"."created_at_shop",
            "shopify_orders"."gross_total",
            "shopify_orders"."financial_status"
           FROM "public"."shopify_orders"
          WHERE (("shopify_orders"."email" IS NOT NULL) AND ("shopify_orders"."email" <> ''::"text"))
        ), "cli" AS (
         SELECT "ord"."email",
            ("min"("ord"."created_at_shop"))::"date" AS "primo_ordine",
            ("max"("ord"."created_at_shop"))::"date" AS "ultimo_ordine",
            (CURRENT_DATE - ("max"("ord"."created_at_shop"))::"date") AS "recency_giorni",
            "count"(*) AS "frequency",
            "round"("sum"("ord"."gross_total") FILTER (WHERE ("ord"."financial_status" <> 'refunded'::"text")), 2) AS "monetary",
            "count"(*) FILTER (WHERE ("ord"."financial_status" <> 'refunded'::"text")) AS "ordini_validi"
           FROM "ord"
          GROUP BY "ord"."email"
        ), "p" AS (
         SELECT "percentile_cont"((0.9)::double precision) WITHIN GROUP (ORDER BY (("cli"."monetary")::double precision)) AS "p90"
           FROM "cli"
        )
 SELECT "c"."email",
    "c"."primo_ordine",
    "c"."ultimo_ordine",
    "c"."recency_giorni",
    "c"."frequency",
    COALESCE("c"."monetary", (0)::numeric) AS "monetary",
        CASE
            WHEN ("c"."ordini_validi" > 0) THEN "round"(("c"."monetary" / ("c"."ordini_validi")::numeric), 2)
            ELSE NULL::numeric
        END AS "aov",
        CASE
            WHEN (((COALESCE("c"."monetary", (0)::numeric))::double precision >= "p"."p90") AND ("p"."p90" > (0)::double precision)) THEN 'top'::"text"
            WHEN ("c"."frequency" >= 2) THEN 'ripetuto'::"text"
            WHEN ("c"."recency_giorni" <= 60) THEN 'nuovo'::"text"
            WHEN ("c"."recency_giorni" > 120) THEN 'dormiente'::"text"
            ELSE 'una_tantum'::"text"
        END AS "segmento"
   FROM "cli" "c",
    "p";


ALTER VIEW "public"."v_clienti_rfm" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_conto_vendita_negozio" AS
 WITH "cv" AS (
         SELECT "b2b_movements"."negozio",
            "b2b_movements"."codice_norm",
            "sum"(
                CASE
                    WHEN ("b2b_movements"."tipo_movimento" = 'invio'::"text") THEN "b2b_movements"."quantita"
                    WHEN ("b2b_movements"."tipo_movimento" = ANY (ARRAY['reso'::"text", 'venduto'::"text"])) THEN (- "b2b_movements"."quantita")
                    ELSE (0)::numeric
                END) AS "pezzi"
           FROM "public"."b2b_movements"
          WHERE (("b2b_movements"."modello" = 'conto_vendita'::"text") AND ("b2b_movements"."negozio" IS NOT NULL))
          GROUP BY "b2b_movements"."negozio", "b2b_movements"."codice_norm"
        )
 SELECT "cv"."negozio",
    "p"."codice",
    "p"."item",
    "p"."variant",
    "p"."image_url",
    "cv"."pezzi"
   FROM ("cv"
     JOIN "public"."products" "p" ON (("p"."codice_norm" = "cv"."codice_norm")))
  WHERE ("cv"."pezzi" > (0)::numeric);


ALTER VIEW "public"."v_conto_vendita_negozio" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_digest_log_attori_14gg" AS
 SELECT COALESCE("chi", '—'::"text") AS "chi",
    ("count"(*))::integer AS "n"
   FROM "public"."change_log"
  WHERE ((("ts")::"date" >= (CURRENT_DATE - 13)) AND (("ts")::"date" <= CURRENT_DATE))
  GROUP BY COALESCE("chi", '—'::"text")
  ORDER BY (("count"(*))::integer) DESC;


ALTER VIEW "public"."v_digest_log_attori_14gg" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_digest_ordini_14gg" AS
 SELECT "order_number",
    "customer_name",
    ("created_at_shop")::"date" AS "data",
    ("fulfilled_at" IS NOT NULL) AS "evaso",
    "gross_total"
   FROM "public"."shopify_orders" "o"
  WHERE ((("created_at_shop")::"date" >= (CURRENT_DATE - 13)) AND (("created_at_shop")::"date" <= CURRENT_DATE))
  ORDER BY "created_at_shop" DESC;


ALTER VIEW "public"."v_digest_ordini_14gg" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_inventory" AS
 WITH "pur" AS (
         SELECT "purchases"."codice_norm",
            "sum"("purchases"."quantita") AS "q"
           FROM "public"."purchases"
          GROUP BY "purchases"."codice_norm"
        ), "sho" AS (
         SELECT "shopify_line_items"."codice_norm",
            "sum"("shopify_line_items"."quantita") AS "q"
           FROM "public"."shopify_line_items"
          GROUP BY "shopify_line_items"."codice_norm"
        ), "qro" AS (
         SELECT "qromo_sales"."codice_norm",
            "sum"("qromo_sales"."quantita") AS "q"
           FROM "public"."qromo_sales"
          GROUP BY "qromo_sales"."codice_norm"
        ), "gif" AS (
         SELECT "gifts_offline"."codice_norm",
            "sum"("gifts_offline"."quantita") AS "q"
           FROM "public"."gifts_offline"
          GROUP BY "gifts_offline"."codice_norm"
        ), "ret" AS (
         SELECT "returns"."codice_norm",
            "sum"("returns"."quantita") AS "q"
           FROM "public"."returns"
          WHERE ("returns"."rientra_stock" = true)
          GROUP BY "returns"."codice_norm"
        ), "adj" AS (
         SELECT "stock_adjustments"."codice_norm",
            "sum"("stock_adjustments"."qty_delta") AS "q"
           FROM "public"."stock_adjustments"
          GROUP BY "stock_adjustments"."codice_norm"
        ), "b2v" AS (
         SELECT "b2b_movements"."codice_norm",
            "sum"("b2b_movements"."quantita") AS "q"
           FROM "public"."b2b_movements"
          WHERE ("b2b_movements"."tipo_movimento" = 'venduto'::"text")
          GROUP BY "b2b_movements"."codice_norm"
        ), "b2cv" AS (
         SELECT "b2b_movements"."codice_norm",
            "sum"(
                CASE
                    WHEN ("b2b_movements"."tipo_movimento" = 'invio'::"text") THEN "b2b_movements"."quantita"
                    WHEN ("b2b_movements"."tipo_movimento" = ANY (ARRAY['reso'::"text", 'venduto'::"text"])) THEN (- "b2b_movements"."quantita")
                    ELSE (0)::numeric
                END) AS "q"
           FROM "public"."b2b_movements"
          WHERE ("b2b_movements"."modello" = 'conto_vendita'::"text")
          GROUP BY "b2b_movements"."codice_norm"
        ), "last_sale" AS (
         SELECT "s"."codice_norm",
            "max"("s"."d") AS "d"
           FROM ( SELECT "qromo_sales"."codice_norm",
                    ("qromo_sales"."data")::timestamp with time zone AS "d"
                   FROM "public"."qromo_sales"
                  WHERE ("qromo_sales"."data" IS NOT NULL)
                UNION ALL
                 SELECT "b2b_movements"."codice_norm",
                    ("b2b_movements"."data")::timestamp with time zone AS "data"
                   FROM "public"."b2b_movements"
                  WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND ("b2b_movements"."data" IS NOT NULL))
                UNION ALL
                 SELECT "li"."codice_norm",
                    "o"."created_at_shop"
                   FROM ("public"."shopify_line_items" "li"
                     JOIN "public"."shopify_orders" "o" ON (("o"."order_id" = "li"."order_id")))
                  WHERE ("o"."created_at_shop" IS NOT NULL)) "s"
          GROUP BY "s"."codice_norm"
        ), "shop" AS (
         SELECT "upper"("regexp_replace"(COALESCE("shopify_stock"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) AS "codice_norm",
            "max"("shopify_stock"."image_url") AS "image_url",
            "bool_or"((COALESCE("shopify_stock"."shopify_status", 'active'::"text") = 'active'::"text")) AS "is_active"
           FROM "public"."shopify_stock"
          WHERE (("shopify_stock"."codice" IS NOT NULL) AND ("shopify_stock"."codice" <> ''::"text"))
          GROUP BY ("upper"("regexp_replace"(COALESCE("shopify_stock"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")))
        )
 SELECT "p"."codice",
    "p"."codice_norm",
    "p"."item",
    "p"."variant",
    "p"."categoria",
    "p"."retail_price",
    "p"."cogs",
    COALESCE("p"."image_url", "shop"."image_url") AS "image_url",
    "p"."status",
    COALESCE("pur"."q", (0)::numeric) AS "qty_purchased",
    COALESCE("sho"."q", (0)::numeric) AS "shopify_sold",
    COALESCE("qro"."q", (0)::numeric) AS "qromo_sold",
    COALESCE("gif"."q", (0)::numeric) AS "gift_sold",
    COALESCE("b2v"."q", (0)::numeric) AS "b2b_venduto",
    COALESCE("b2cv"."q", (0)::numeric) AS "in_conto_vendita",
    (((((COALESCE("pur"."q", (0)::numeric) - COALESCE("sho"."q", (0)::numeric)) - COALESCE("qro"."q", (0)::numeric)) - COALESCE("gif"."q", (0)::numeric)) + COALESCE("ret"."q", (0)::numeric)) + COALESCE("adj"."q", (0)::numeric)) AS "giacenza_attuale",
    ((((((COALESCE("pur"."q", (0)::numeric) - COALESCE("sho"."q", (0)::numeric)) - COALESCE("qro"."q", (0)::numeric)) - COALESCE("gif"."q", (0)::numeric)) + COALESCE("ret"."q", (0)::numeric)) + COALESCE("adj"."q", (0)::numeric)) - COALESCE("b2v"."q", (0)::numeric)) AS "giacenza_totale_conb2b",
    (((((((COALESCE("pur"."q", (0)::numeric) - COALESCE("sho"."q", (0)::numeric)) - COALESCE("qro"."q", (0)::numeric)) - COALESCE("gif"."q", (0)::numeric)) + COALESCE("ret"."q", (0)::numeric)) + COALESCE("adj"."q", (0)::numeric)) - COALESCE("b2v"."q", (0)::numeric)) - COALESCE("b2cv"."q", (0)::numeric)) AS "disponibili_da_vendere",
    "round"(((((((COALESCE("pur"."q", (0)::numeric) - COALESCE("sho"."q", (0)::numeric)) - COALESCE("qro"."q", (0)::numeric)) - COALESCE("gif"."q", (0)::numeric)) + COALESCE("ret"."q", (0)::numeric)) + COALESCE("adj"."q", (0)::numeric)) * COALESCE("p"."retail_price", (0)::numeric)), 2) AS "valore",
    "ls"."d" AS "last_sale",
    (("shop"."codice_norm" IS NOT NULL) AND "shop"."is_active") AS "on_shopify",
    COALESCE("ret"."q", (0)::numeric) AS "resi_rientrati",
    COALESCE("adj"."q", (0)::numeric) AS "aggiustamenti"
   FROM (((((((((("public"."products" "p"
     LEFT JOIN "pur" ON (("pur"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "sho" ON (("sho"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "qro" ON (("qro"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "gif" ON (("gif"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "ret" ON (("ret"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "adj" ON (("adj"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "b2v" ON (("b2v"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "b2cv" ON (("b2cv"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "last_sale" "ls" ON (("ls"."codice_norm" = "p"."codice_norm")))
     LEFT JOIN "shop" ON (("shop"."codice_norm" = "p"."codice_norm")));


ALTER VIEW "public"."v_inventory" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_products_todo" AS
 WITH "self" AS (
         SELECT "p"."id",
            "p"."codice",
            "p"."codice_norm",
            "p"."is_finalized",
            "p"."model",
            "p"."variant",
            "p"."item",
            "p"."categoria",
            "p"."shopify_name",
            "p"."shopify_sku",
            "p"."retail_price",
            "p"."cogs",
            "p"."description",
            "p"."seo_title",
            "p"."image_url",
            "p"."status",
            "p"."notes",
            "p"."source",
            "p"."chi",
            "p"."created_at",
            "p"."updated_at",
            "p"."verificato",
            "upper"("regexp_replace"(COALESCE("p"."model", "p"."item", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) AS "model_key"
           FROM "public"."products" "p"
        ), "base" AS (
         SELECT "s_1"."id",
            "s_1"."codice",
            "s_1"."codice_norm",
            "s_1"."is_finalized",
            "s_1"."model",
            "s_1"."variant",
            "s_1"."item",
            "s_1"."categoria",
            "s_1"."shopify_name",
            "s_1"."shopify_sku",
            "s_1"."retail_price",
            "s_1"."cogs",
            "s_1"."description",
            "s_1"."seo_title",
            "s_1"."image_url",
            "s_1"."status",
            "s_1"."notes",
            "s_1"."source",
            "s_1"."chi",
            "s_1"."created_at",
            "s_1"."updated_at",
            "s_1"."verificato",
            "s_1"."model_key",
            "i"."giacenza_attuale",
            "i"."shopify_sold",
            "i"."qromo_sold",
            "i"."b2b_venduto",
            "i"."on_shopify" AS "inv_on_shopify",
            ((EXISTS ( SELECT 1
                   FROM "public"."supplier_orders" "so"
                  WHERE ("upper"("regexp_replace"("so"."codice", '\s+'::"text", '_'::"text", 'g'::"text")) = "s_1"."codice_norm"))) OR (COALESCE("i"."qty_purchased", (0)::numeric) <> (0)::numeric) OR (COALESCE("i"."shopify_sold", (0)::numeric) <> (0)::numeric) OR (COALESCE("i"."qromo_sold", (0)::numeric) <> (0)::numeric) OR (COALESCE("i"."gift_sold", (0)::numeric) <> (0)::numeric) OR (COALESCE("i"."b2b_venduto", (0)::numeric) <> (0)::numeric) OR (COALESCE("i"."resi_rientrati", (0)::numeric) <> (0)::numeric) OR (COALESCE("i"."aggiustamenti", (0)::numeric) <> (0)::numeric)) AS "attivita"
           FROM ("self" "s_1"
             LEFT JOIN "public"."v_inventory" "i" ON (("i"."codice" = "s_1"."codice")))
        )
 SELECT "codice",
    "item",
    "variant",
    "model",
    "categoria",
    "image_url",
    "retail_price",
    "cogs",
    "description",
    "seo_title",
    "is_finalized",
    "verificato",
    "notes",
    ((((
        CASE
            WHEN (COALESCE(TRIM(BOTH FROM "item"), ''::"text") = ''::"text") THEN 1
            ELSE 0
        END +
        CASE
            WHEN (COALESCE(TRIM(BOTH FROM "variant"), ''::"text") = ''::"text") THEN 1
            ELSE 0
        END) +
        CASE
            WHEN (COALESCE(TRIM(BOTH FROM "image_url"), ''::"text") = ''::"text") THEN 1
            ELSE 0
        END) +
        CASE
            WHEN (("retail_price" IS NULL) OR ("retail_price" = (0)::numeric)) THEN 1
            ELSE 0
        END) +
        CASE
            WHEN (COALESCE(TRIM(BOTH FROM "description"), ''::"text") = ''::"text") THEN 1
            ELSE 0
        END) AS "missing_count",
    COALESCE("giacenza_attuale", (0)::numeric) AS "giacenza",
    ((COALESCE("shopify_sold", (0)::numeric) + COALESCE("qromo_sold", (0)::numeric)) + COALESCE("b2b_venduto", (0)::numeric)) AS "venduto",
    COALESCE("inv_on_shopify", false) AS "on_shopify",
    "source",
        CASE
            WHEN ("model_key" = ''::"text") THEN true
            ELSE (NOT (EXISTS ( SELECT 1
               FROM "public"."products" "o"
              WHERE (("o"."codice" <> "s"."codice") AND ("o"."verificato" = true) AND ("upper"("regexp_replace"(COALESCE("o"."model", "o"."item", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) = "s"."model_key")))))
        END AS "is_new_model",
        CASE
            WHEN (("source" = 'app-ordine'::"text") AND ("verificato" = false) AND "attivita") THEN 'nuovo'::"text"
            WHEN (("source" = 'app-ordine'::"text") AND ("verificato" = false) AND (NOT "attivita")) THEN 'pulizia'::"text"
            WHEN (("retail_price" IS NULL) OR ("retail_price" = (0)::numeric) OR ("cogs" IS NULL) OR ("cogs" = (0)::numeric)) THEN 'costo_ricavo'::"text"
            ELSE 'pulizia'::"text"
        END AS "bucket",
        CASE
            WHEN (("source" = 'app-ordine'::"text") AND ("verificato" = false) AND "attivita") THEN 0
            WHEN (("source" = 'app-ordine'::"text") AND ("verificato" = false) AND (NOT "attivita")) THEN 2
            WHEN (("retail_price" IS NULL) OR ("retail_price" = (0)::numeric) OR ("cogs" IS NULL) OR ("cogs" = (0)::numeric)) THEN 1
            ELSE 2
        END AS "bucket_rank",
    (("source" = 'app-ordine'::"text") AND ("verificato" = false) AND (NOT "attivita")) AS "stub_orfano"
   FROM "base" "s"
  WHERE (("verificato" = false) OR (COALESCE(TRIM(BOTH FROM "item"), ''::"text") = ''::"text") OR (COALESCE(TRIM(BOTH FROM "variant"), ''::"text") = ''::"text") OR ("retail_price" IS NULL) OR ("retail_price" = (0)::numeric) OR ("cogs" IS NULL) OR ("cogs" = (0)::numeric) OR (("source" = 'app-ordine'::"text") AND (COALESCE(TRIM(BOTH FROM "image_url"), ''::"text") = ''::"text")));


ALTER VIEW "public"."v_products_todo" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_digest_persone" AS
 WITH "ord" AS (
         SELECT "count"(*) FILTER (WHERE ((("shopify_orders"."created_at_shop")::"date" >= (CURRENT_DATE - 13)) AND (("shopify_orders"."created_at_shop")::"date" <= CURRENT_DATE))) AS "add14",
            "count"(*) FILTER (WHERE ((("shopify_orders"."created_at_shop")::"date" >= (CURRENT_DATE - 27)) AND (("shopify_orders"."created_at_shop")::"date" <= (CURRENT_DATE - 14)))) AS "add28",
            "count"(*) FILTER (WHERE ((("shopify_orders"."fulfilled_at")::"date" >= (CURRENT_DATE - 13)) AND (("shopify_orders"."fulfilled_at")::"date" <= CURRENT_DATE))) AS "ful14",
            "count"(*) FILTER (WHERE ((("shopify_orders"."fulfilled_at")::"date" >= (CURRENT_DATE - 27)) AND (("shopify_orders"."fulfilled_at")::"date" <= (CURRENT_DATE - 14)))) AS "ful28"
           FROM "public"."shopify_orders"
        ), "onl" AS (
         SELECT COALESCE("sum"(("li"."price" * "li"."quantita")) FILTER (WHERE ((("o"."created_at_shop")::"date" >= (CURRENT_DATE - 13)) AND (("o"."created_at_shop")::"date" <= CURRENT_DATE))), (0)::numeric) AS "on_lordo14"
           FROM ("public"."shopify_line_items" "li"
             JOIN "public"."shopify_orders" "o" USING ("order_id"))
        ), "cl" AS (
         SELECT "count"(*) FILTER (WHERE (((("change_log"."ts")::"date" >= (CURRENT_DATE - 13)) AND (("change_log"."ts")::"date" <= CURRENT_DATE)) AND ("change_log"."op" ~* '(uppercase|merge|maiuscol|finalize|clean|rename|norm)'::"text"))) AS "puliti14",
            "count"(*) FILTER (WHERE (((("change_log"."ts")::"date" >= (CURRENT_DATE - 13)) AND (("change_log"."ts")::"date" <= CURRENT_DATE)) AND ("change_log"."op" = ANY (ARRAY['expense_approve'::"text", 'expense_manual'::"text"])))) AS "spese14",
            "count"(*) FILTER (WHERE ((("change_log"."ts")::"date" >= (CURRENT_DATE - 13)) AND (("change_log"."ts")::"date" <= CURRENT_DATE))) AS "log14",
            "count"(DISTINCT "change_log"."chi") FILTER (WHERE ((("change_log"."ts")::"date" >= (CURRENT_DATE - 13)) AND (("change_log"."ts")::"date" <= CURRENT_DATE))) AS "attori14"
           FROM "public"."change_log"
        ), "ret" AS (
         SELECT "count"(*) FILTER (WHERE (("returns"."data" >= (CURRENT_DATE - 13)) AND ("returns"."data" <= CURRENT_DATE))) AS "resi14"
           FROM "public"."returns"
        ), "todo" AS (
         SELECT ("count"(*))::integer AS "n"
           FROM "public"."v_products_todo"
        ), "hl" AS (
         SELECT "count"(*) FILTER (WHERE ("health_log"."severity" = 'ok'::"text")) AS "ok",
            "count"(*) FILTER (WHERE ("health_log"."severity" = 'warn'::"text")) AS "warn",
            "count"(*) FILTER (WHERE ("health_log"."severity" = ANY (ARRAY['bad'::"text", 'error'::"text"]))) AS "bad",
            "count"(*) FILTER (WHERE (("health_log"."severity" = ANY (ARRAY['bad'::"text", 'error'::"text"])) AND (("health_log"."k" ~ '^ce_'::"text") OR ("health_log"."k" = 'period_mismatch'::"text")))) AS "ce_bad"
           FROM "public"."health_log"
          WHERE ("health_log"."day" = ( SELECT "max"("health_log_1"."day") AS "max"
                   FROM "public"."health_log" "health_log_1"))
        )
 SELECT "ord"."add14" AS "gin_ordini14",
    "ord"."add28" AS "gin_ordini28",
    "ord"."ful14" AS "gin_evasi14",
    "ord"."ful28" AS "gin_evasi28",
    "round"(("onl"."on_lordo14" / (NULLIF("ord"."add14", 0))::numeric), 2) AS "gin_aov14",
    "cl"."puliti14" AS "ben_puliti14",
    "ret"."resi14" AS "ben_resi14",
    "cl"."spese14" AS "ben_spese14",
    "todo"."n" AS "ben_todo",
    "cl"."log14" AS "dan_log14",
    "cl"."attori14" AS "dan_attori14",
    "hl"."ok" AS "dan_health_ok",
    "hl"."warn" AS "dan_health_warn",
    "hl"."bad" AS "dan_health_bad",
    "hl"."ce_bad" AS "dan_ce_bad"
   FROM "ord",
    "onl",
    "cl",
    "ret",
    "todo",
    "hl";


ALTER VIEW "public"."v_digest_persone" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_digest_pulizia_14gg" AS
 SELECT ("ts")::"date" AS "data",
    "op",
    COALESCE("chi", '—'::"text") AS "chi",
    "tbl",
    "row_id"
   FROM "public"."change_log" "cl"
  WHERE (((("ts")::"date" >= (CURRENT_DATE - 13)) AND (("ts")::"date" <= CURRENT_DATE)) AND ("op" ~* '(uppercase|merge|maiuscol|finalize|clean|rename|norm)'::"text"))
  ORDER BY "ts" DESC;


ALTER VIEW "public"."v_digest_pulizia_14gg" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_digest_spese_14gg" AS
 SELECT ("cl"."ts")::"date" AS "data",
    "cl"."op",
    COALESCE("cl"."chi", '—'::"text") AS "chi",
    "e"."operazione",
    "e"."costo"
   FROM ("public"."change_log" "cl"
     LEFT JOIN "public"."expenses" "e" ON ((("e"."id")::"text" = "cl"."row_id")))
  WHERE (((("cl"."ts")::"date" >= (CURRENT_DATE - 13)) AND (("cl"."ts")::"date" <= CURRENT_DATE)) AND ("cl"."op" = ANY (ARRAY['expense_approve'::"text", 'expense_manual'::"text"])))
  ORDER BY "cl"."ts" DESC;


ALTER VIEW "public"."v_digest_spese_14gg" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_digest_versioni" WITH ("security_invoker"='false') AS
 SELECT ( SELECT "count"(*) AS "count"
           FROM "supabase_migrations"."schema_migrations") AS "migr_n",
    ( SELECT "max"("schema_migrations"."version") AS "max"
           FROM "supabase_migrations"."schema_migrations") AS "migr_last";


ALTER VIEW "public"."v_digest_versioni" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_expenses_pending" AS
 SELECT "id",
    "date_reported",
    "date_paid",
    "operazione",
    "costo",
    "categoria",
    "sottocategoria",
    "amimi",
    "note",
    "proposed_by",
    "status",
    "created_at"
   FROM "public"."expenses"
  WHERE ("status" = 'pending'::"text")
  ORDER BY "created_at" DESC;


ALTER VIEW "public"."v_expenses_pending" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_expenses_review" AS
 SELECT "id",
    "year",
    "month",
    "date_reported",
    "date_paid",
    "operazione",
    "costo",
    "categoria",
    "sottocategoria",
    "amimi",
    "amimi_raw",
    "note",
    "status",
    "proposed_by",
    "created_at"
   FROM "public"."expenses"
  WHERE (("status" = 'pending'::"text") OR (("status" <> 'rejected'::"text") AND ("note" ~* 'da verificare'::"text")))
  ORDER BY "year" DESC, "month" DESC, "created_at" DESC;


ALTER VIEW "public"."v_expenses_review" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_fornitore_prodotti" AS
 SELECT "pu"."fornitore",
    "pu"."codice",
    "max"(COALESCE("p"."item", "pu"."item")) AS "item",
    "max"(COALESCE("p"."variant", "pu"."variant")) AS "variant",
    ("array_agg"("pu"."costo_unitario" ORDER BY "pu"."data" DESC NULLS LAST) FILTER (WHERE ("pu"."costo_unitario" IS NOT NULL)))[1] AS "ultimo_costo",
    "max"("pu"."data") AS "ultima_data",
    COALESCE("max"("p"."image_url"), "max"("ss"."image_url")) AS "image_url",
    "count"(*) AS "n_ordini"
   FROM (("public"."purchases" "pu"
     LEFT JOIN "public"."products" "p" ON (("p"."codice" = "pu"."codice")))
     LEFT JOIN ( SELECT "upper"("regexp_replace"(COALESCE("shopify_stock"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) AS "codice_norm",
            "max"("shopify_stock"."image_url") AS "image_url"
           FROM "public"."shopify_stock"
          GROUP BY ("upper"("regexp_replace"(COALESCE("shopify_stock"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")))) "ss" ON (("ss"."codice_norm" = "pu"."codice_norm")))
  WHERE (COALESCE(TRIM(BOTH FROM "pu"."fornitore"), ''::"text") <> ''::"text")
  GROUP BY "pu"."fornitore", "pu"."codice";


ALTER VIEW "public"."v_fornitore_prodotti" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_sku_availability" AS
 SELECT "codice",
    "item",
    "variant",
    "image_url",
    "giacenza_attuale" AS "giacenza",
    "disponibili_da_vendere" AS "disponibili",
    "on_shopify",
        CASE
            WHEN ("on_shopify" AND ("disponibili_da_vendere" > (0)::numeric)) THEN 'acquistabile'::"text"
            WHEN (("giacenza_attuale" > (0)::numeric) AND (NOT "on_shopify")) THEN 'in_stock_non_pubblicato'::"text"
            WHEN ("on_shopify" AND ("disponibili_da_vendere" <= (0)::numeric)) THEN 'pubblicato_esaurito'::"text"
            ELSE 'altro'::"text"
        END AS "stato"
   FROM "public"."v_inventory" "i"
  WHERE (COALESCE(TRIM(BOTH FROM "item"), ''::"text") <> ''::"text");


ALTER VIEW "public"."v_sku_availability" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_health" AS
 WITH "checks" AS (
         SELECT 'img_missing'::"text" AS "k",
            'Prodotti online senza immagine'::"text" AS "label",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."v_inventory"
                  WHERE ("v_inventory"."on_shopify" AND ("v_inventory"."image_url" IS NULL))) AS "n"
        UNION ALL
         SELECT 'stock_neg'::"text",
            'Prodotti con giacenza negativa'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."v_inventory"
                  WHERE ("v_inventory"."giacenza_attuale" < (0)::numeric)) AS "count"
        UNION ALL
         SELECT 'cogs_missing'::"text",
            'Prodotti venduti senza COGS'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."v_inventory"
                  WHERE ((((COALESCE("v_inventory"."shopify_sold", (0)::numeric) + COALESCE("v_inventory"."qromo_sold", (0)::numeric)) + COALESCE("v_inventory"."b2b_venduto", (0)::numeric)) > (0)::numeric) AND (COALESCE("v_inventory"."cogs", (0)::numeric) = (0)::numeric))) AS "count"
        UNION ALL
         SELECT 'price_missing'::"text",
            'Prodotti su Shopify senza prezzo'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."v_inventory"
                  WHERE ("v_inventory"."on_shopify" AND (COALESCE("v_inventory"."retail_price", (0)::numeric) = (0)::numeric))) AS "count"
        UNION ALL
         SELECT 'orders_orphan'::"text",
            'Righe ordine con codice non in anagrafica'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."supplier_orders" "so"
                  WHERE ((COALESCE("so"."codice", ''::"text") <> ''::"text") AND (NOT (EXISTS ( SELECT 1
                           FROM "public"."products" "p"
                          WHERE ("p"."codice_norm" = "upper"("regexp_replace"("so"."codice", '\s+'::"text", '_'::"text", 'g'::"text")))))))) AS "count"
        UNION ALL
         SELECT 'todo_products'::"text",
            'Prodotti da completare'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."v_products_todo") AS "count"
        UNION ALL
         SELECT 'lost_sales'::"text",
            'SKU pubblicati ma esauriti'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."v_sku_availability"
                  WHERE ("v_sku_availability"."stato" = 'pubblicato_esaurito'::"text")) AS "count"
        UNION ALL
         SELECT 'shopify_orphan'::"text",
            'Vendite Shopify non agganciate a un prodotto (ricavo con COGS 0, stock non scalato)'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."shopify_line_items"
                  WHERE ((COALESCE("shopify_line_items"."lineitem_name", ''::"text") <> ''::"text") AND ("shopify_line_items"."codice" IS NULL))) AS "count"
        UNION ALL
         SELECT 'qromo_orphan'::"text",
            'Vendite Qromo con codice non in anagrafica (ricavo sì, stock no)'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."qromo_sales" "q"
                  WHERE ((COALESCE("q"."codice", ''::"text") <> ''::"text") AND (NOT (EXISTS ( SELECT 1
                           FROM "public"."products" "p"
                          WHERE ("p"."codice_norm" = "q"."codice_norm")))) AND (NOT (EXISTS ( SELECT 1
                           FROM "public"."non_product_codici" "n"
                          WHERE ("upper"("regexp_replace"("n"."codice", '\s+'::"text", '_'::"text", 'g'::"text")) = "q"."codice_norm")))))) AS "count"
        UNION ALL
         SELECT 'dup_codice'::"text",
            'CODICE duplicati in anagrafica (raddoppiano giacenza/valore)'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM ( SELECT "products"."codice_norm"
                           FROM "public"."products"
                          GROUP BY "products"."codice_norm"
                         HAVING ("count"(*) > 1)) "d") AS "count"
        UNION ALL
         SELECT 'period_mismatch'::"text",
            'Righe col mese/anno diverso dalla data (finiscono nel CE del mese sbagliato)'::"text",
            ((((( SELECT "count"(*) AS "count"
                   FROM "public"."qromo_sales"
                  WHERE (("qromo_sales"."data" IS NOT NULL) AND (("qromo_sales"."year" IS DISTINCT FROM (EXTRACT(year FROM "qromo_sales"."data"))::integer) OR ("qromo_sales"."month" IS DISTINCT FROM (EXTRACT(month FROM "qromo_sales"."data"))::integer)))) + ( SELECT "count"(*) AS "count"
                   FROM "public"."expenses"
                  WHERE (("expenses"."date_paid" IS NOT NULL) AND (("expenses"."year" IS DISTINCT FROM (EXTRACT(year FROM "expenses"."date_paid"))::integer) OR ("expenses"."month" IS DISTINCT FROM (EXTRACT(month FROM "expenses"."date_paid"))::integer))))) + ( SELECT "count"(*) AS "count"
                   FROM "public"."returns"
                  WHERE (("returns"."data" IS NOT NULL) AND (("returns"."year" IS DISTINCT FROM (EXTRACT(year FROM "returns"."data"))::integer) OR ("returns"."month" IS DISTINCT FROM (EXTRACT(month FROM "returns"."data"))::integer))))) + ( SELECT "count"(*) AS "count"
                   FROM "public"."gifts_offline"
                  WHERE (("gifts_offline"."data" IS NOT NULL) AND (("gifts_offline"."year" IS DISTINCT FROM (EXTRACT(year FROM "gifts_offline"."data"))::integer) OR ("gifts_offline"."month" IS DISTINCT FROM (EXTRACT(month FROM "gifts_offline"."data"))::integer))))) + ( SELECT "count"(*) AS "count"
                   FROM "public"."b2b_movements"
                  WHERE (("b2b_movements"."data" IS NOT NULL) AND (("b2b_movements"."year" IS DISTINCT FROM (EXTRACT(year FROM "b2b_movements"."data"))::integer) OR ("b2b_movements"."month" IS DISTINCT FROM (EXTRACT(month FROM "b2b_movements"."data"))::integer)))))
        UNION ALL
         SELECT 'ce_drift_live'::"text",
            'Mesi CHIUSI i cui numeri sono cambiati (netto o utile mc2)'::"text",
            ( SELECT "count"(*) AS "count"
                   FROM "public"."v_ce_drift"
                  WHERE (("abs"(COALESCE("v_ce_drift"."delta_netto", (0)::numeric)) > 0.01) OR ("abs"(COALESCE("v_ce_drift"."delta_mc2", (0)::numeric)) > 0.01))) AS "count"
        )
 SELECT "k",
    "label",
    "n",
        CASE
            WHEN ("n" = 0) THEN 'ok'::"text"
            WHEN ("k" = ANY (ARRAY['stock_neg'::"text", 'cogs_missing'::"text", 'price_missing'::"text", 'orders_orphan'::"text", 'shopify_orphan'::"text", 'qromo_orphan'::"text", 'dup_codice'::"text", 'period_mismatch'::"text", 'ce_drift_live'::"text"])) THEN 'bad'::"text"
            ELSE 'warn'::"text"
        END AS "severity"
   FROM "checks";


ALTER VIEW "public"."v_health" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_last_sale" AS
 WITH "s" AS (
         SELECT "qromo_sales"."codice_norm",
            ("qromo_sales"."data")::timestamp with time zone AS "d",
            ("qromo_sales"."prezzo")::numeric AS "price"
           FROM "public"."qromo_sales"
          WHERE ("qromo_sales"."data" IS NOT NULL)
        UNION ALL
         SELECT "li"."codice_norm",
            "o"."created_at_shop" AS "d",
            ("li"."price")::numeric AS "price"
           FROM ("public"."shopify_line_items" "li"
             JOIN "public"."shopify_orders" "o" ON (("o"."order_id" = "li"."order_id")))
          WHERE ("o"."created_at_shop" IS NOT NULL)
        UNION ALL
         SELECT "b2b_movements"."codice_norm",
            ("b2b_movements"."data")::timestamp with time zone AS "d",
            ("b2b_movements"."prezzo_retail")::numeric AS "prezzo_retail"
           FROM "public"."b2b_movements"
          WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND ("b2b_movements"."data" IS NOT NULL))
        )
 SELECT DISTINCT ON ("codice_norm") "codice_norm",
    ("d")::"date" AS "last_date",
    "price" AS "last_price"
   FROM "s"
  ORDER BY "codice_norm", "d" DESC NULLS LAST;


ALTER VIEW "public"."v_last_sale" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_margine_ordine" AS
 WITH "li" AS (
         SELECT "shopify_line_items"."order_id",
            "sum"("shopify_line_items"."quantita") AS "pezzi",
            "sum"(("shopify_line_items"."price" * "shopify_line_items"."quantita")) AS "ricavo_lordo",
            "sum"(("shopify_line_items"."cogs_snapshot" * "shopify_line_items"."quantita")) AS "cogs"
           FROM "public"."shopify_line_items"
          GROUP BY "shopify_line_items"."order_id"
        )
 SELECT "o"."order_id",
    "o"."order_number",
    "o"."created_at_shop",
    "o"."year",
    "o"."month",
    "li"."pezzi",
    "round"("li"."ricavo_lordo", 2) AS "ricavo_lordo",
    "round"("o"."discount_total", 2) AS "sconto",
    "round"((("li"."ricavo_lordo" - "o"."discount_total") / 1.22), 2) AS "ricavo_netto",
    "round"("li"."cogs", 2) AS "cogs",
    "round"((- "o"."payment_fees"), 2) AS "commissioni",
    "round"(((3.71 * "li"."pezzi") + 1.00), 2) AS "packaging",
    "round"((COALESCE("o"."shipping_total", (0)::numeric) + COALESCE("o"."free_shipping_amt", (0)::numeric)), 2) AS "spedizione_incassata",
    "round"(COALESCE("o"."refund_amount", (0)::numeric), 2) AS "rimborso",
    "round"((((((("li"."ricavo_lordo" - "o"."discount_total") / 1.22) - "li"."cogs") - (- "o"."payment_fees")) - ((3.71 * "li"."pezzi") + 1.00)) - (COALESCE("o"."refund_amount", (0)::numeric) / 1.22)), 2) AS "margine_contribuzione",
    "round"(
        CASE
            WHEN (("li"."ricavo_lordo" - "o"."discount_total") <> (0)::numeric) THEN (((((((("li"."ricavo_lordo" - "o"."discount_total") / 1.22) - "li"."cogs") - (- "o"."payment_fees")) - ((3.71 * "li"."pezzi") + 1.00)) - (COALESCE("o"."refund_amount", (0)::numeric) / 1.22)) / (("li"."ricavo_lordo" - "o"."discount_total") / 1.22)) * (100)::numeric)
            ELSE NULL::numeric
        END, 2) AS "margine_pct",
    (COALESCE("o"."refund_amount", (0)::numeric) > (0)::numeric) AS "refunded",
    "o"."financial_status"
   FROM ("public"."shopify_orders" "o"
     JOIN "li" ON (("li"."order_id" = "o"."order_id")));


ALTER VIEW "public"."v_margine_ordine" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_margine_ordine" IS 'Profitto per ordine online (brief A4). Il rimborso e IVA-inclusivo e viene sottratto dal ricavo netto, MAI dal cogs (returns e vuota: non sappiamo se la merce e rientrata). Spedizione incassata esposta ma fuori dal margine. Nessun dato personale del cliente per scelta (l app principale legge in anon).';



CREATE OR REPLACE VIEW "public"."v_margine_sku" AS
 WITH "ord_val" AS (
         SELECT "shopify_line_items"."order_id",
            "sum"(("shopify_line_items"."price" * "shopify_line_items"."quantita")) AS "valore_ordine"
           FROM "public"."shopify_line_items"
          GROUP BY "shopify_line_items"."order_id"
        ), "riga" AS (
         SELECT "l"."codice_norm",
            "l"."year",
            "l"."month",
            'online'::"text" AS "canale",
            "l"."quantita" AS "pezzi",
            ("l"."price" * "l"."quantita") AS "ricavo_lordo",
            ("o"."discount_total" * "q"."quota") AS "sconto",
            ((- "o"."payment_fees") * "q"."quota") AS "commissioni",
            ((3.71 * "l"."quantita") + (1.00 * "q"."quota")) AS "packaging",
            ("l"."cogs_snapshot" * "l"."quantita") AS "cogs",
                CASE
                    WHEN ("o"."refund_amount" > (0)::numeric) THEN "l"."quantita"
                    ELSE (0)::numeric
                END AS "pezzi_rimborsati"
           FROM ((("public"."shopify_line_items" "l"
             JOIN "public"."shopify_orders" "o" ON (("o"."order_id" = "l"."order_id")))
             JOIN "ord_val" "ov" ON (("ov"."order_id" = "l"."order_id")))
             CROSS JOIN LATERAL ( SELECT
                        CASE
                            WHEN ("ov"."valore_ordine" > (0)::numeric) THEN (("l"."price" * "l"."quantita") / "ov"."valore_ordine")
                            ELSE (0)::numeric
                        END AS "quota") "q")
          WHERE ("l"."year" IS NOT NULL)
        UNION ALL
         SELECT "s"."codice_norm",
            "s"."year",
            "s"."month",
            'offline'::"text" AS "text",
            "s"."quantita",
            "s"."prezzo",
            (0)::numeric AS "numeric",
            (0)::numeric AS "numeric",
            (3.71 * "s"."quantita"),
            ("s"."cogs" * "s"."quantita"),
            (0)::numeric AS "numeric"
           FROM "public"."qromo_sales" "s"
          WHERE ("s"."year" IS NOT NULL)
        ), "agg" AS (
         SELECT "riga"."codice_norm",
            "riga"."year",
            "riga"."month",
            "riga"."canale",
            "sum"("riga"."pezzi") AS "pezzi",
            "sum"("riga"."ricavo_lordo") AS "ricavo_lordo",
            "sum"("riga"."sconto") AS "sconto",
            "sum"("riga"."commissioni") AS "commissioni",
            "sum"("riga"."packaging") AS "packaging",
            "sum"("riga"."cogs") AS "cogs",
            "sum"("riga"."pezzi_rimborsati") AS "pezzi_in_ordini_rimborsati"
           FROM "riga"
          GROUP BY "riga"."codice_norm", "riga"."year", "riga"."month", "riga"."canale"
        )
 SELECT COALESCE("p"."codice", "a"."codice_norm") AS "codice",
    "a"."codice_norm",
    "p"."item",
    "p"."variant",
    "a"."year",
    "a"."month",
    "a"."canale",
    "a"."pezzi",
    "round"("a"."ricavo_lordo", 2) AS "ricavo_lordo",
    "round"("a"."sconto", 2) AS "sconto",
    "round"((("a"."ricavo_lordo" - "a"."sconto") / 1.22), 2) AS "ricavo_netto",
    "round"("a"."cogs", 2) AS "cogs",
    "round"("a"."commissioni", 2) AS "commissioni",
    "round"("a"."packaging", 2) AS "packaging",
    "round"(((((("a"."ricavo_lordo" - "a"."sconto") / 1.22) - "a"."cogs") - "a"."commissioni") - "a"."packaging"), 2) AS "margine_contribuzione",
    "round"(
        CASE
            WHEN (("a"."ricavo_lordo" - "a"."sconto") <> (0)::numeric) THEN ((((((("a"."ricavo_lordo" - "a"."sconto") / 1.22) - "a"."cogs") - "a"."commissioni") - "a"."packaging") / (("a"."ricavo_lordo" - "a"."sconto") / 1.22)) * (100)::numeric)
            ELSE NULL::numeric
        END, 2) AS "margine_pct",
    "a"."pezzi_in_ordini_rimborsati"
   FROM ("agg" "a"
     LEFT JOIN "public"."products" "p" ON (("p"."codice_norm" = "a"."codice_norm")));


ALTER VIEW "public"."v_margine_sku" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_margine_sku" IS 'Contribution margin per codice x anno x mese x canale (brief A4). Costi POSITIVI, margine = ricavo_netto - cogs - commissioni - packaging. Offline: prezzo e il TOTALE riga, cogs e per unita (stesso quirk di gifts_offline). Spedizione esclusa; rimborsi NON allocati alla riga. Riconciliazione col CE in amimi-app/docs/SCHEMA.md.';



CREATE OR REPLACE VIEW "public"."v_movimenti_14gg" AS
 WITH "off" AS (
         SELECT COALESCE("sum"("qromo_sales"."quantita") FILTER (WHERE (("qromo_sales"."data" >= (CURRENT_DATE - 13)) AND ("qromo_sales"."data" <= CURRENT_DATE))), (0)::numeric) AS "u14",
            COALESCE("sum"(("qromo_sales"."prezzo" * "qromo_sales"."quantita")) FILTER (WHERE (("qromo_sales"."data" >= (CURRENT_DATE - 13)) AND ("qromo_sales"."data" <= CURRENT_DATE))), (0)::numeric) AS "g14",
            COALESCE("sum"("qromo_sales"."quantita") FILTER (WHERE (("qromo_sales"."data" >= (CURRENT_DATE - 27)) AND ("qromo_sales"."data" <= (CURRENT_DATE - 14)))), (0)::numeric) AS "u28",
            COALESCE("sum"(("qromo_sales"."prezzo" * "qromo_sales"."quantita")) FILTER (WHERE (("qromo_sales"."data" >= (CURRENT_DATE - 27)) AND ("qromo_sales"."data" <= (CURRENT_DATE - 14)))), (0)::numeric) AS "g28"
           FROM "public"."qromo_sales"
        ), "onl" AS (
         SELECT COALESCE("sum"("li"."quantita") FILTER (WHERE ((("o"."created_at_shop")::"date" >= (CURRENT_DATE - 13)) AND (("o"."created_at_shop")::"date" <= CURRENT_DATE))), (0)::numeric) AS "u14",
            COALESCE("sum"(("li"."price" * "li"."quantita")) FILTER (WHERE ((("o"."created_at_shop")::"date" >= (CURRENT_DATE - 13)) AND (("o"."created_at_shop")::"date" <= CURRENT_DATE))), (0)::numeric) AS "g14",
            COALESCE("sum"("li"."quantita") FILTER (WHERE ((("o"."created_at_shop")::"date" >= (CURRENT_DATE - 27)) AND (("o"."created_at_shop")::"date" <= (CURRENT_DATE - 14)))), (0)::numeric) AS "u28",
            COALESCE("sum"(("li"."price" * "li"."quantita")) FILTER (WHERE ((("o"."created_at_shop")::"date" >= (CURRENT_DATE - 27)) AND (("o"."created_at_shop")::"date" <= (CURRENT_DATE - 14)))), (0)::numeric) AS "g28"
           FROM ("public"."shopify_line_items" "li"
             JOIN "public"."shopify_orders" "o" USING ("order_id"))
        ), "ordc" AS (
         SELECT "count"(*) FILTER (WHERE ((("shopify_orders"."created_at_shop")::"date" >= (CURRENT_DATE - 13)) AND (("shopify_orders"."created_at_shop")::"date" <= CURRENT_DATE))) AS "o14",
            "count"(*) FILTER (WHERE ((("shopify_orders"."created_at_shop")::"date" >= (CURRENT_DATE - 27)) AND (("shopify_orders"."created_at_shop")::"date" <= (CURRENT_DATE - 14)))) AS "o28"
           FROM "public"."shopify_orders"
        ), "mov" AS (
         SELECT ( SELECT "count"(*) FILTER (WHERE ((COALESCE("supplier_orders"."data_ordine", ("supplier_orders"."created_at")::"date") >= (CURRENT_DATE - 13)) AND (COALESCE("supplier_orders"."data_ordine", ("supplier_orders"."created_at")::"date") <= CURRENT_DATE))) AS "count"
                   FROM "public"."supplier_orders") AS "sup_new14",
            ( SELECT "count"(*) FILTER (WHERE (("supplier_orders"."data_ultimo_arrivo" >= (CURRENT_DATE - 13)) AND ("supplier_orders"."data_ultimo_arrivo" <= CURRENT_DATE))) AS "count"
                   FROM "public"."supplier_orders") AS "sup_arr14",
            ( SELECT "count"(*) FILTER (WHERE (COALESCE("supplier_orders"."qty_arrived", (0)::numeric) < COALESCE("supplier_orders"."qty_ordered", (0)::numeric))) AS "count"
                   FROM "public"."supplier_orders") AS "sup_open",
            ( SELECT "count"(*) FILTER (WHERE (("returns"."data" >= (CURRENT_DATE - 13)) AND ("returns"."data" <= CURRENT_DATE))) AS "count"
                   FROM "public"."returns") AS "ret14",
            ( SELECT "count"(*) FILTER (WHERE (("returns"."data" >= (CURRENT_DATE - 27)) AND ("returns"."data" <= (CURRENT_DATE - 14)))) AS "count"
                   FROM "public"."returns") AS "ret28"
        ), "cat" AS (
         SELECT ( SELECT "count"(DISTINCT "shopify_stock"."codice") AS "count"
                   FROM "public"."shopify_stock"
                  WHERE ("shopify_stock"."shopify_status" = 'active'::"text")) AS "live",
            ( SELECT "count"(DISTINCT "shopify_stock"."codice") AS "count"
                   FROM "public"."shopify_stock"
                  WHERE ("shopify_stock"."shopify_status" = 'draft'::"text")) AS "draft",
            ( SELECT "count"(DISTINCT "shopify_stock"."codice") AS "count"
                   FROM "public"."shopify_stock"
                  WHERE (("shopify_stock"."shopify_status" = 'active'::"text") AND (COALESCE("shopify_stock"."shopify_qty", (0)::numeric) = (0)::numeric))) AS "soldout"
        )
 SELECT "off"."u14" AS "off_pezzi14",
    "off"."g14" AS "off_lordo14",
    "off"."u28" AS "off_pezzi28",
    "off"."g28" AS "off_lordo28",
    "onl"."u14" AS "on_pezzi14",
    "onl"."g14" AS "on_lordo14",
    "onl"."u28" AS "on_pezzi28",
    "onl"."g28" AS "on_lordo28",
    ("off"."u14" + "onl"."u14") AS "pezzi14",
    ("off"."u28" + "onl"."u28") AS "pezzi28",
    ("off"."g14" + "onl"."g14") AS "lordo14",
    ("off"."g28" + "onl"."g28") AS "lordo28",
    "round"((("off"."g14" + "onl"."g14") / 1.22), 2) AS "netto14",
    "round"((("off"."g28" + "onl"."g28") / 1.22), 2) AS "netto28",
    "ordc"."o14" AS "ordini14",
    "ordc"."o28" AS "ordini28",
        CASE
            WHEN ("ordc"."o14" > 0) THEN "round"((("off"."g14" + "onl"."g14") / ("ordc"."o14")::numeric), 2)
            ELSE NULL::numeric
        END AS "aov_lordo14",
    "mov"."sup_new14",
    "mov"."sup_arr14",
    "mov"."sup_open",
    "mov"."ret14",
    "mov"."ret28",
    "cat"."live",
    "cat"."draft",
    "cat"."soldout"
   FROM "off",
    "onl",
    "ordc",
    "mov",
    "cat";


ALTER VIEW "public"."v_movimenti_14gg" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ops_flags" AS
 SELECT ( SELECT "app_flags"."value"
           FROM "public"."app_flags"
          WHERE ("app_flags"."key" = 'shopify_write_enabled'::"text")) AS "shopify_write_enabled",
    ( SELECT "app_flags"."value"
           FROM "public"."app_flags"
          WHERE ("app_flags"."key" = 'shopify_autopush_enabled'::"text")) AS "shopify_autopush_enabled",
    ( SELECT "app_flags"."value"
           FROM "public"."app_flags"
          WHERE ("app_flags"."key" = 'shopify_hold_raises'::"text")) AS "shopify_hold_raises",
    ( SELECT "app_flags"."value"
           FROM "public"."app_flags"
          WHERE ("app_flags"."key" = 'shopify_expose_buffer'::"text")) AS "shopify_expose_buffer",
    ( SELECT "app_config"."ai_enabled"
           FROM "public"."app_config"
          WHERE ("app_config"."id" = 1)) AS "ai_enabled";


ALTER VIEW "public"."v_ops_flags" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_ordini_arrivo" AS
 SELECT "o"."id",
    "o"."gruppo",
    "o"."codice",
    "o"."item",
    "o"."variant",
    "o"."fornitore",
    "o"."qty_ordered",
    "o"."qty_arrived",
    (COALESCE("o"."qty_ordered", (0)::numeric) - COALESCE("o"."qty_arrived", (0)::numeric)) AS "mancano",
        CASE
            WHEN "o"."wip" THEN (COALESCE("o"."qty_arrived", (0)::numeric) > (0)::numeric)
            ELSE (COALESCE("o"."qty_arrived", (0)::numeric) >= COALESCE("o"."qty_ordered", (0)::numeric))
        END AS "completo",
    "o"."nuovo_riordino",
    "o"."costo_unitario",
    "o"."data_consegna",
    "o"."data_ordine",
    "o"."data_ultimo_arrivo",
    "o"."note",
    COALESCE("p"."image_url", "ss"."image_url") AS "image_url",
    "o"."wip",
    COALESCE("o"."data_consegna", "o"."data_ultimo_arrivo") AS "data_consegna_display"
   FROM (("public"."supplier_orders" "o"
     LEFT JOIN "public"."products" "p" ON (("p"."codice_norm" = "upper"("regexp_replace"(COALESCE("o"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")))))
     LEFT JOIN ( SELECT "upper"("regexp_replace"(COALESCE("shopify_stock"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) AS "codice_norm",
            "max"("shopify_stock"."image_url") AS "image_url"
           FROM "public"."shopify_stock"
          GROUP BY ("upper"("regexp_replace"(COALESCE("shopify_stock"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")))) "ss" ON (("ss"."codice_norm" = "upper"("regexp_replace"(COALESCE("o"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")))));


ALTER VIEW "public"."v_ordini_arrivo" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_products_to_publish" AS
 WITH "shop" AS (
         SELECT "upper"("regexp_replace"("shopify_stock"."codice", '\s+'::"text", '_'::"text", 'g'::"text")) AS "codice_norm"
           FROM "public"."shopify_stock"
          WHERE ("shopify_stock"."synced_at" >= (( SELECT COALESCE("max"("shopify_stock_1"."synced_at"), "now"()) AS "coalesce"
                   FROM "public"."shopify_stock" "shopify_stock_1") - '02:00:00'::interval))
        ), "self" AS (
         SELECT "p"."id",
            "p"."codice",
            "p"."codice_norm",
            "p"."is_finalized",
            "p"."model",
            "p"."variant",
            "p"."item",
            "p"."categoria",
            "p"."shopify_name",
            "p"."shopify_sku",
            "p"."retail_price",
            "p"."cogs",
            "p"."description",
            "p"."seo_title",
            "p"."image_url",
            "p"."status",
            "p"."notes",
            "p"."source",
            "p"."chi",
            "p"."created_at",
            "p"."updated_at",
            "p"."verificato",
            "p"."riordino_archiviato",
            "upper"("regexp_replace"(COALESCE("p"."model", "p"."item", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) AS "model_key"
           FROM "public"."products" "p"
        ), "nm" AS (
         SELECT "s"."id",
            "s"."codice",
            "s"."codice_norm",
            "s"."is_finalized",
            "s"."model",
            "s"."variant",
            "s"."item",
            "s"."categoria",
            "s"."shopify_name",
            "s"."shopify_sku",
            "s"."retail_price",
            "s"."cogs",
            "s"."description",
            "s"."seo_title",
            "s"."image_url",
            "s"."status",
            "s"."notes",
            "s"."source",
            "s"."chi",
            "s"."created_at",
            "s"."updated_at",
            "s"."verificato",
            "s"."riordino_archiviato",
            "s"."model_key",
                CASE
                    WHEN ("s"."model_key" = ''::"text") THEN true
                    ELSE (NOT (EXISTS ( SELECT 1
                       FROM "public"."products" "o"
                      WHERE (("o"."codice" <> "s"."codice") AND ("o"."verificato" = true) AND ("upper"("regexp_replace"(COALESCE("o"."model", "o"."item", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) = "s"."model_key")))))
                END AS "is_new_model"
           FROM "self" "s"
        )
 SELECT "n"."codice",
    "n"."item",
    "n"."variant",
    "n"."model",
    ("m"."model" IS NOT NULL) AS "modello_censito",
    "m"."categoria",
    "m"."product_type",
    "m"."template_suffix",
    "m"."collections",
    "n"."retail_price",
    "n"."cogs",
    "n"."image_url",
    "n"."description",
    "n"."seo_title",
    "n"."is_new_model",
    COALESCE("i"."disponibili_da_vendere", (0)::numeric) AS "disponibili_da_vendere",
    (COALESCE("i"."disponibili_da_vendere", (0)::numeric) > (0)::numeric) AS "pronto_stock"
   FROM (("nm" "n"
     LEFT JOIN "public"."v_inventory" "i" ON (("i"."codice" = "n"."codice")))
     LEFT JOIN "public"."models" "m" ON (("m"."model_norm" = "n"."model_key")))
  WHERE (("n"."source" = 'app-ordine'::"text") AND (COALESCE(TRIM(BOTH FROM "n"."item"), ''::"text") <> ''::"text") AND (COALESCE(TRIM(BOTH FROM "n"."variant"), ''::"text") <> ''::"text") AND (COALESCE("n"."retail_price", (0)::numeric) > (0)::numeric) AND (COALESCE("n"."cogs", (0)::numeric) > (0)::numeric) AND (COALESCE(TRIM(BOTH FROM "n"."image_url"), ''::"text") <> ''::"text") AND ((NOT "n"."is_new_model") OR (COALESCE(TRIM(BOTH FROM "n"."description"), ''::"text") <> ''::"text")) AND ("n"."codice" !~ '_$'::"text") AND (NOT (EXISTS ( SELECT 1
           FROM "shop" "sh"
          WHERE ("sh"."codice_norm" = "n"."codice_norm")))));


ALTER VIEW "public"."v_products_to_publish" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_reorder" AS
 WITH "sold60" AS (
         SELECT "s_1"."codice_norm",
            "sum"("s_1"."q") AS "q"
           FROM ( SELECT "qromo_sales"."codice_norm",
                    "qromo_sales"."quantita" AS "q"
                   FROM "public"."qromo_sales"
                  WHERE ("qromo_sales"."data" >= (CURRENT_DATE - 60))
                UNION ALL
                 SELECT "li"."codice_norm",
                    "li"."quantita"
                   FROM ("public"."shopify_line_items" "li"
                     JOIN "public"."shopify_orders" "o" ON (("o"."order_id" = "li"."order_id")))
                  WHERE ("o"."created_at_shop" >= (CURRENT_DATE - 60))
                UNION ALL
                 SELECT "b2b_movements"."codice_norm",
                    "b2b_movements"."quantita"
                   FROM "public"."b2b_movements"
                  WHERE (("b2b_movements"."tipo_movimento" = 'venduto'::"text") AND ("b2b_movements"."data" >= (CURRENT_DATE - 60)))) "s_1"
          GROUP BY "s_1"."codice_norm"
        ), "arrivo" AS (
         SELECT "upper"("regexp_replace"(COALESCE("supplier_orders"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")) AS "codice_norm",
            "sum"(GREATEST((COALESCE("supplier_orders"."qty_ordered", (0)::numeric) - COALESCE("supplier_orders"."qty_arrived", (0)::numeric)), (0)::numeric)) AS "q"
           FROM "public"."supplier_orders"
          GROUP BY ("upper"("regexp_replace"(COALESCE("supplier_orders"."codice", ''::"text"), '\s+'::"text", '_'::"text", 'g'::"text")))
        )
 SELECT "i"."codice",
    "i"."item",
    "i"."variant",
    "i"."image_url",
    "i"."giacenza_attuale" AS "giacenza",
    "i"."disponibili_da_vendere" AS "disponibili",
    "i"."on_shopify",
    COALESCE("s"."q", (0)::numeric) AS "venduto_60d",
    COALESCE("a"."q", (0)::numeric) AS "in_arrivo",
        CASE
            WHEN (COALESCE("s"."q", (0)::numeric) > (0)::numeric) THEN "round"(("i"."giacenza_attuale" / ("s"."q" / 60.0)), 0)
            ELSE NULL::numeric
        END AS "giorni_stock",
    COALESCE("p"."riordino_archiviato", false) AS "riordino_archiviato"
   FROM ((("public"."v_inventory" "i"
     LEFT JOIN "public"."products" "p" ON (("p"."codice_norm" = "i"."codice_norm")))
     LEFT JOIN "sold60" "s" ON (("s"."codice_norm" = "i"."codice_norm")))
     LEFT JOIN "arrivo" "a" ON (("a"."codice_norm" = "i"."codice_norm")))
  WHERE ((COALESCE("s"."q", (0)::numeric) > (0)::numeric) OR ("i"."giacenza_attuale" > (0)::numeric));


ALTER VIEW "public"."v_reorder" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_resi_mensile" AS
 SELECT "year",
    "month",
    "canale",
    "count"(*) AS "n",
    "sum"("quantita") AS "pezzi",
    "sum"(COALESCE("importo_rimborsato", (0)::numeric)) AS "importo"
   FROM "public"."returns"
  GROUP BY "year", "month", "canale";


ALTER VIEW "public"."v_resi_mensile" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_sales_anomalie" AS
 WITH "vend" AS (
         SELECT "upper"("li"."codice") AS "codice",
            "sum"("li"."quantita") FILTER (WHERE (("o"."created_at_shop" >= ("now"() - '44 days'::interval)) AND ("o"."created_at_shop" < ("now"() - '14 days'::interval)))) AS "prima_30gg",
            "sum"("li"."quantita") FILTER (WHERE ("o"."created_at_shop" >= ("now"() - '14 days'::interval))) AS "ultimi_14gg"
           FROM ("public"."shopify_line_items" "li"
             JOIN "public"."shopify_orders" "o" ON (("o"."order_id" = "li"."order_id")))
          WHERE (("o"."created_at_shop" >= ("now"() - '44 days'::interval)) AND ("li"."codice" IS NOT NULL))
          GROUP BY ("upper"("li"."codice"))
        ), "med" AS (
         SELECT "percentile_cont"((0.5)::double precision) WITHIN GROUP (ORDER BY (("v_reorder"."venduto_60d")::double precision)) AS "m"
           FROM "public"."v_reorder"
          WHERE ("v_reorder"."venduto_60d" > (0)::numeric)
        )
 SELECT 'best_seller_fermo'::"text" AS "tipo",
    "v"."codice",
    "format"('%s pezzi nei 30gg precedenti, 0 negli ultimi 14, disponibili %s'::"text", "v"."prima_30gg", "i"."disponibili_da_vendere") AS "dettaglio",
    "v"."prima_30gg" AS "valore"
   FROM (("vend" "v"
     JOIN "public"."v_inventory" "i" ON (("upper"("i"."codice") = "v"."codice")))
     CROSS JOIN ( SELECT "alert_rules"."soglia"
           FROM "public"."alert_rules"
          WHERE ("alert_rules"."metrica" = 'sales_best_seller_fermo'::"text")) "r")
  WHERE ((COALESCE("v"."prima_30gg", (0)::numeric) >= "r"."soglia") AND (COALESCE("v"."ultimi_14gg", (0)::numeric) = (0)::numeric) AND ("i"."disponibili_da_vendere" > (0)::numeric))
UNION ALL
 SELECT 'low_stock'::"text" AS "tipo",
    "r2"."codice",
    "format"('%s giorni di stock, venduto_60d %s (mediana %s)'::"text", "r2"."giorni_stock", "r2"."venduto_60d", "round"(("med"."m")::numeric, 1)) AS "dettaglio",
    "r2"."giorni_stock" AS "valore"
   FROM "public"."v_reorder" "r2",
    ("med"
     CROSS JOIN ( SELECT "alert_rules"."soglia"
           FROM "public"."alert_rules"
          WHERE ("alert_rules"."metrica" = 'sales_low_stock'::"text")) "rr")
  WHERE (("r2"."giorni_stock" IS NOT NULL) AND ("r2"."giorni_stock" <= "rr"."soglia") AND (("r2"."venduto_60d")::double precision > "med"."m"))
UNION ALL
 SELECT 'esaurito_pubblicato'::"text" AS "tipo",
    "v_sku_availability"."codice",
    'pubblicato su Shopify ma esaurito'::"text" AS "dettaglio",
    0 AS "valore"
   FROM "public"."v_sku_availability"
  WHERE ("v_sku_availability"."stato" = 'pubblicato_esaurito'::"text")
UNION ALL
 SELECT 'sconto_anomalo'::"text" AS "tipo",
    "s"."cod" AS "codice",
    "format"('%s usi negli ultimi %s giorni (soglia %s)'::"text", "s"."usi", "rs"."finestra_giorni", "rs"."soglia") AS "dettaglio",
    ("s"."usi")::numeric AS "valore"
   FROM (( SELECT "upper"(TRIM(BOTH FROM "o"."discount_codes")) AS "cod",
            "count"(*) AS "usi"
           FROM ("public"."shopify_orders" "o"
             CROSS JOIN ( SELECT "alert_rules"."finestra_giorni"
                   FROM "public"."alert_rules"
                  WHERE ("alert_rules"."metrica" = 'sales_sconto_anomalo'::"text")) "f")
          WHERE (("o"."created_at_shop" >= ("now"() - (("f"."finestra_giorni" || ' days'::"text"))::interval)) AND ("o"."discount_codes" IS NOT NULL) AND (TRIM(BOTH FROM "o"."discount_codes") <> ''::"text"))
          GROUP BY ("upper"(TRIM(BOTH FROM "o"."discount_codes"))), "f"."finestra_giorni") "s"
     CROSS JOIN ( SELECT "alert_rules"."soglia",
            "alert_rules"."finestra_giorni"
           FROM "public"."alert_rules"
          WHERE ("alert_rules"."metrica" = 'sales_sconto_anomalo'::"text")) "rs")
  WHERE (("s"."usi")::numeric > "rs"."soglia");


ALTER VIEW "public"."v_sales_anomalie" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_shopify_align" AS
 SELECT "i"."codice",
    "i"."item",
    "i"."variant",
    "i"."image_url",
    "i"."giacenza_attuale" AS "giacenza",
    "i"."disponibili_da_vendere" AS "disponibili",
    "s"."shopify_qty",
    "s"."synced_at",
    (COALESCE("s"."shopify_qty", (0)::numeric) - COALESCE("i"."disponibili_da_vendere", (0)::numeric)) AS "diff",
    "i"."on_shopify"
   FROM ("public"."v_inventory" "i"
     LEFT JOIN "public"."shopify_stock" "s" ON (("s"."codice" = "i"."codice")))
  WHERE (("i"."on_shopify" = true) OR ("s"."codice" IS NOT NULL));


ALTER VIEW "public"."v_shopify_align" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_stock_drift" AS
 WITH "buf" AS (
         SELECT COALESCE(( SELECT ("app_flags"."value")::integer AS "value"
                   FROM "public"."app_flags"
                  WHERE ("app_flags"."key" = 'shopify_expose_buffer'::"text")), 2) AS "b"
        ), "fresh" AS (
         SELECT DISTINCT "counts"."codice"
           FROM "public"."counts"
          WHERE ("counts"."data_conta" >= (CURRENT_DATE - 30))
        )
 SELECT "ss"."codice",
    "ss"."shopify_title",
    "ss"."shopify_qty",
    (GREATEST((0)::numeric, COALESCE("vi"."disponibili_da_vendere", (0)::numeric)))::integer AS "disponibili",
    ("f"."codice" IS NOT NULL) AS "conta_fresca",
    (
        CASE
            WHEN ("f"."codice" IS NOT NULL) THEN GREATEST((0)::numeric, COALESCE("vi"."disponibili_da_vendere", (0)::numeric))
            ELSE GREATEST((0)::numeric, (COALESCE("vi"."disponibili_da_vendere", (0)::numeric) - (( SELECT "buf"."b"
               FROM "buf"))::numeric))
        END)::integer AS "target_policy",
    ((
        CASE
            WHEN ("f"."codice" IS NOT NULL) THEN GREATEST((0)::numeric, COALESCE("vi"."disponibili_da_vendere", (0)::numeric))
            ELSE GREATEST((0)::numeric, (COALESCE("vi"."disponibili_da_vendere", (0)::numeric) - (( SELECT "buf"."b"
               FROM "buf"))::numeric))
        END - COALESCE("ss"."shopify_qty", (0)::numeric)))::integer AS "delta",
        CASE
            WHEN (
            CASE
                WHEN ("f"."codice" IS NOT NULL) THEN GREATEST((0)::numeric, COALESCE("vi"."disponibili_da_vendere", (0)::numeric))
                ELSE GREATEST((0)::numeric, (COALESCE("vi"."disponibili_da_vendere", (0)::numeric) - (( SELECT "buf"."b"
                   FROM "buf"))::numeric))
            END = COALESCE("ss"."shopify_qty", (0)::numeric)) THEN 'ok'::"text"
            WHEN (
            CASE
                WHEN ("f"."codice" IS NOT NULL) THEN GREATEST((0)::numeric, COALESCE("vi"."disponibili_da_vendere", (0)::numeric))
                ELSE GREATEST((0)::numeric, (COALESCE("vi"."disponibili_da_vendere", (0)::numeric) - (( SELECT "buf"."b"
                   FROM "buf"))::numeric))
            END < COALESCE("ss"."shopify_qty", (0)::numeric)) THEN 'da_abbassare'::"text"
            WHEN ("f"."codice" IS NOT NULL) THEN 'da_alzare'::"text"
            ELSE 'hold_serve_conta'::"text"
        END AS "azione",
    "ss"."synced_at"
   FROM (("public"."shopify_stock" "ss"
     LEFT JOIN "public"."v_inventory" "vi" ON (("vi"."codice" = "ss"."codice")))
     LEFT JOIN "fresh" "f" ON (("f"."codice" = "ss"."codice")));


ALTER VIEW "public"."v_stock_drift" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ce_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ce_snapshots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."cs_knowledge" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cs_knowledge_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."health_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."health_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."alert_rules"
    ADD CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("metrica");



ALTER TABLE ONLY "public"."app_config"
    ADD CONSTRAINT "app_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_flags"
    ADD CONSTRAINT "app_flags_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."app_guides"
    ADD CONSTRAINT "app_guides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."b2b_movements"
    ADD CONSTRAINT "b2b_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ce_snapshots"
    ADD CONSTRAINT "ce_snapshots_ce_year_month_key" UNIQUE ("ce", "year", "month");



ALTER TABLE ONLY "public"."ce_snapshots"
    ADD CONSTRAINT "ce_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ce_totale_manual"
    ADD CONSTRAINT "ce_totale_manual_pkey" PRIMARY KEY ("year", "month");



ALTER TABLE ONLY "public"."ce_totale_monthly"
    ADD CONSTRAINT "ce_totale_monthly_pkey" PRIMARY KEY ("year", "month");



ALTER TABLE ONLY "public"."change_log"
    ADD CONSTRAINT "change_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."counts"
    ADD CONSTRAINT "counts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cs_conversations"
    ADD CONSTRAINT "cs_conversations_gmail_thread_id_key" UNIQUE ("gmail_thread_id");



ALTER TABLE ONLY "public"."cs_conversations"
    ADD CONSTRAINT "cs_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cs_drafts"
    ADD CONSTRAINT "cs_drafts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cs_events"
    ADD CONSTRAINT "cs_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cs_faq"
    ADD CONSTRAINT "cs_faq_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cs_knowledge"
    ADD CONSTRAINT "cs_knowledge_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cs_messages"
    ADD CONSTRAINT "cs_messages_gmail_message_id_key" UNIQUE ("gmail_message_id");



ALTER TABLE ONLY "public"."cs_messages"
    ADD CONSTRAINT "cs_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cs_sends"
    ADD CONSTRAINT "cs_sends_pkey" PRIMARY KEY ("send_key");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gifts_offline"
    ADD CONSTRAINT "gifts_offline_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."health_log"
    ADD CONSTRAINT "health_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_events"
    ADD CONSTRAINT "loyalty_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_points"
    ADD CONSTRAINT "loyalty_points_pkey" PRIMARY KEY ("shopify_customer_id");



ALTER TABLE ONLY "public"."meta_ads_daily"
    ADD CONSTRAINT "meta_ads_daily_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mimi_state"
    ADD CONSTRAINT "mimi_state_pkey" PRIMARY KEY ("shopify_customer_id");



ALTER TABLE ONLY "public"."models"
    ADD CONSTRAINT "models_pkey" PRIMARY KEY ("model");



ALTER TABLE ONLY "public"."negozi"
    ADD CONSTRAINT "negozi_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."non_product_codici"
    ADD CONSTRAINT "non_product_codici_pkey" PRIMARY KEY ("codice");



ALTER TABLE ONLY "public"."product_aliases"
    ADD CONSTRAINT "product_aliases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_codice_unique" UNIQUE ("codice");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."qromo_sales"
    ADD CONSTRAINT "qromo_sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."returns"
    ADD CONSTRAINT "returns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shipping_status"
    ADD CONSTRAINT "shipping_status_pkey" PRIMARY KEY ("ldv");



ALTER TABLE ONLY "public"."shopify_catalog"
    ADD CONSTRAINT "shopify_catalog_pkey" PRIMARY KEY ("codice");



ALTER TABLE ONLY "public"."shopify_line_items"
    ADD CONSTRAINT "shopify_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shopify_orders"
    ADD CONSTRAINT "shopify_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shopify_stock"
    ADD CONSTRAINT "shopify_stock_pkey" PRIMARY KEY ("codice");



ALTER TABLE ONLY "public"."stock_adjustments"
    ADD CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_orders"
    ADD CONSTRAINT "supplier_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



CREATE INDEX "b2b_codice_idx" ON "public"."b2b_movements" USING "btree" ("codice_norm");



CREATE INDEX "b2b_ym_idx" ON "public"."b2b_movements" USING "btree" ("year", "month");



CREATE INDEX "change_log_tbl_idx" ON "public"."change_log" USING "btree" ("tbl", "ts");



CREATE INDEX "counts_codice_idx" ON "public"."counts" USING "btree" ("codice");



CREATE INDEX "cs_conv_canale_idx" ON "public"."cs_conversations" USING "btree" ("canale");



CREATE INDEX "cs_conv_lastmsg_idx" ON "public"."cs_conversations" USING "btree" ("last_msg_at" DESC);



CREATE INDEX "cs_conv_stato_idx" ON "public"."cs_conversations" USING "btree" ("stato");



CREATE INDEX "cs_msg_conv_idx" ON "public"."cs_messages" USING "btree" ("conversation_id", "sent_at");



CREATE INDEX "cs_sends_conv_idx" ON "public"."cs_sends" USING "btree" ("conversation_id", "created_at" DESC);



CREATE INDEX "expenses_cat_idx" ON "public"."expenses" USING "btree" ("categoria");



CREATE INDEX "expenses_ym_idx" ON "public"."expenses" USING "btree" ("year", "month");



CREATE INDEX "gifts_codice_idx" ON "public"."gifts_offline" USING "btree" ("codice_norm");



CREATE INDEX "gifts_ym_idx" ON "public"."gifts_offline" USING "btree" ("year", "month");



CREATE UNIQUE INDEX "health_log_day_k" ON "public"."health_log" USING "btree" ("day", "k");



CREATE INDEX "idx_stock_adjustments_codice_norm" ON "public"."stock_adjustments" USING "btree" ("codice_norm");



CREATE INDEX "loyalty_events_cust_created_idx" ON "public"."loyalty_events" USING "btree" ("shopify_customer_id", "created_at" DESC);



CREATE INDEX "meta_ads_date_idx" ON "public"."meta_ads_daily" USING "btree" ("date", "campaign_id");



CREATE UNIQUE INDEX "models_model_norm_uq" ON "public"."models" USING "btree" ("model_norm");



CREATE INDEX "product_aliases_codice_idx" ON "public"."product_aliases" USING "btree" ("codice");



CREATE INDEX "product_aliases_name_idx" ON "public"."product_aliases" USING "btree" ("shopify_name_norm");



CREATE INDEX "products_codice_norm_idx" ON "public"."products" USING "btree" ("codice_norm");



CREATE UNIQUE INDEX "products_codice_norm_uq" ON "public"."products" USING "btree" ("codice_norm");



CREATE INDEX "purchases_codice_idx" ON "public"."purchases" USING "btree" ("codice_norm");



CREATE INDEX "purchases_data_idx" ON "public"."purchases" USING "btree" ("data");



CREATE INDEX "qromo_codice_idx" ON "public"."qromo_sales" USING "btree" ("codice_norm");



CREATE INDEX "qromo_dedup_idx" ON "public"."qromo_sales" USING "btree" ("order_id", "codice_norm");



CREATE UNIQUE INDEX "qromo_sales_live_saleid_uq" ON "public"."qromo_sales" USING "btree" ("sale_id") WHERE (("source" = ANY (ARRAY['qromo-direct'::"text", 'qromo-forward'::"text"])) AND ("sale_id" IS NOT NULL));



CREATE INDEX "qromo_ym_idx" ON "public"."qromo_sales" USING "btree" ("year", "month");



CREATE INDEX "shipping_status_order_idx" ON "public"."shipping_status" USING "btree" ("order_name");



CREATE INDEX "shopify_li_codice_idx" ON "public"."shopify_line_items" USING "btree" ("codice_norm");



CREATE INDEX "shopify_li_orderid_idx" ON "public"."shopify_line_items" USING "btree" ("order_id");



CREATE INDEX "shopify_li_ym_idx" ON "public"."shopify_line_items" USING "btree" ("year", "month");



CREATE INDEX "shopify_orders_orderid_idx" ON "public"."shopify_orders" USING "btree" ("order_id");



CREATE INDEX "shopify_orders_ym_idx" ON "public"."shopify_orders" USING "btree" ("year", "month");



ALTER TABLE ONLY "public"."cs_drafts"
    ADD CONSTRAINT "cs_drafts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."cs_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cs_events"
    ADD CONSTRAINT "cs_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."cs_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cs_messages"
    ADD CONSTRAINT "cs_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."cs_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cs_sends"
    ADD CONSTRAINT "cs_sends_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."cs_conversations"("id") ON DELETE CASCADE;



ALTER TABLE "public"."app_guides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cs_conv_sel" ON "public"."cs_conversations" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."cs_conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cs_drafts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cs_drf_sel" ON "public"."cs_drafts" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."cs_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cs_evt_sel" ON "public"."cs_events" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."cs_faq" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cs_faq_sel" ON "public"."cs_faq" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."cs_knowledge" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cs_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cs_msg_sel" ON "public"."cs_messages" FOR SELECT TO "authenticated" USING ((("auth"."jwt"() ->> 'email'::"text") ~~* '%@amimi.it'::"text"));



ALTER TABLE "public"."cs_sends" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cs_sends_sel" ON "public"."cs_sends" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."loyalty_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_points" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mimi_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."models" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "models_read_all" ON "public"."models" FOR SELECT USING (true);



ALTER TABLE "public"."shipping_status" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shipping_status_read_authenticated" ON "public"."shipping_status" FOR SELECT TO "authenticated" USING (true);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































REVOKE ALL ON FUNCTION "public"."ask_select"("q" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ask_select"("q" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."norm_codice"("t" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."norm_codice"("t" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."norm_codice"("t" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_health_log"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_health_log"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_health_log"() TO "service_role";
























GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."alert_rules" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."alert_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."alert_rules" TO "service_role";



GRANT ALL ON TABLE "public"."app_config" TO "service_role";



GRANT ALL ON TABLE "public"."app_flags" TO "service_role";



GRANT ALL ON TABLE "public"."app_guides" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."b2b_movements" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."b2b_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."b2b_movements" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."ce_snapshots" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."ce_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."ce_snapshots" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ce_snapshots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ce_snapshots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ce_snapshots_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."ce_totale_manual" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."ce_totale_manual" TO "authenticated";
GRANT ALL ON TABLE "public"."ce_totale_manual" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."ce_totale_monthly" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."ce_totale_monthly" TO "authenticated";
GRANT ALL ON TABLE "public"."ce_totale_monthly" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."change_log" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."change_log" TO "authenticated";
GRANT ALL ON TABLE "public"."change_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."change_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."change_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."change_log_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."counts" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."counts" TO "authenticated";
GRANT ALL ON TABLE "public"."counts" TO "service_role";



GRANT ALL ON TABLE "public"."cs_conversations" TO "service_role";
GRANT SELECT ON TABLE "public"."cs_conversations" TO "authenticated";



GRANT ALL ON TABLE "public"."cs_drafts" TO "service_role";
GRANT SELECT ON TABLE "public"."cs_drafts" TO "authenticated";



GRANT ALL ON TABLE "public"."cs_events" TO "service_role";
GRANT SELECT ON TABLE "public"."cs_events" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."cs_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cs_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cs_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cs_faq" TO "service_role";
GRANT SELECT ON TABLE "public"."cs_faq" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."cs_faq_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cs_faq_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cs_faq_id_seq" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."cs_knowledge" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."cs_knowledge" TO "authenticated";
GRANT ALL ON TABLE "public"."cs_knowledge" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cs_knowledge_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cs_knowledge_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cs_knowledge_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cs_messages" TO "service_role";
GRANT SELECT ON TABLE "public"."cs_messages" TO "authenticated";



GRANT ALL ON TABLE "public"."cs_sends" TO "service_role";
GRANT SELECT ON TABLE "public"."cs_sends" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."expenses" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."gifts_offline" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."gifts_offline" TO "authenticated";
GRANT ALL ON TABLE "public"."gifts_offline" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."health_log" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."health_log" TO "authenticated";
GRANT ALL ON TABLE "public"."health_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."health_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."health_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."health_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_events" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_points" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."meta_ads_daily" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."meta_ads_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."meta_ads_daily" TO "service_role";



GRANT ALL ON TABLE "public"."mimi_state" TO "service_role";



GRANT ALL ON TABLE "public"."models" TO "service_role";
GRANT SELECT ON TABLE "public"."models" TO "anon";
GRANT SELECT ON TABLE "public"."models" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."negozi" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."negozi" TO "authenticated";
GRANT ALL ON TABLE "public"."negozi" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."non_product_codici" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."non_product_codici" TO "authenticated";
GRANT ALL ON TABLE "public"."non_product_codici" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."product_aliases" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."product_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."product_aliases" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."products" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."purchases" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."purchases" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."qromo_sales" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."qromo_sales" TO "authenticated";
GRANT ALL ON TABLE "public"."qromo_sales" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."returns" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."returns" TO "authenticated";
GRANT ALL ON TABLE "public"."returns" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shipping_status" TO "authenticated";
GRANT ALL ON TABLE "public"."shipping_status" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_catalog" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."shopify_catalog" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_line_items" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."shopify_line_items" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_orders" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."shopify_orders" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_stock" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."shopify_stock" TO "authenticated";
GRANT ALL ON TABLE "public"."shopify_stock" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."stock_adjustments" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."stock_adjustments" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_adjustments" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."supplier_orders" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."supplier_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."supplier_orders" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."suppliers" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."suppliers" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_mensile" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ads_mensile" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ads_mensile" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_amimi" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_amimi" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ce_amimi" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_amimi_summary" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_amimi_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ce_amimi_summary" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_totale" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_totale" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ce_totale" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_drift" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_drift" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ce_drift" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_totale_summary" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ce_totale_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ce_totale_summary" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_clienti_coorti" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_clienti_coorti" TO "authenticated";
GRANT ALL ON TABLE "public"."v_clienti_coorti" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_clienti_rfm" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_clienti_rfm" TO "authenticated";
GRANT ALL ON TABLE "public"."v_clienti_rfm" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_conto_vendita_negozio" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_conto_vendita_negozio" TO "authenticated";
GRANT ALL ON TABLE "public"."v_conto_vendita_negozio" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_log_attori_14gg" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_log_attori_14gg" TO "authenticated";
GRANT ALL ON TABLE "public"."v_digest_log_attori_14gg" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_ordini_14gg" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_ordini_14gg" TO "authenticated";
GRANT ALL ON TABLE "public"."v_digest_ordini_14gg" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_inventory" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."v_inventory" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_products_todo" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_products_todo" TO "authenticated";
GRANT ALL ON TABLE "public"."v_products_todo" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_persone" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_persone" TO "authenticated";
GRANT ALL ON TABLE "public"."v_digest_persone" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_pulizia_14gg" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_pulizia_14gg" TO "authenticated";
GRANT ALL ON TABLE "public"."v_digest_pulizia_14gg" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_spese_14gg" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_spese_14gg" TO "authenticated";
GRANT ALL ON TABLE "public"."v_digest_spese_14gg" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_versioni" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_digest_versioni" TO "authenticated";
GRANT ALL ON TABLE "public"."v_digest_versioni" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_expenses_pending" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_expenses_pending" TO "authenticated";
GRANT ALL ON TABLE "public"."v_expenses_pending" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_expenses_review" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_expenses_review" TO "authenticated";
GRANT ALL ON TABLE "public"."v_expenses_review" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_fornitore_prodotti" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_fornitore_prodotti" TO "authenticated";
GRANT ALL ON TABLE "public"."v_fornitore_prodotti" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_sku_availability" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_sku_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."v_sku_availability" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_health" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_health" TO "authenticated";
GRANT ALL ON TABLE "public"."v_health" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_last_sale" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_last_sale" TO "authenticated";
GRANT ALL ON TABLE "public"."v_last_sale" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_margine_ordine" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_margine_ordine" TO "authenticated";
GRANT ALL ON TABLE "public"."v_margine_ordine" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_margine_sku" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_margine_sku" TO "authenticated";
GRANT ALL ON TABLE "public"."v_margine_sku" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_movimenti_14gg" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_movimenti_14gg" TO "authenticated";
GRANT ALL ON TABLE "public"."v_movimenti_14gg" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ops_flags" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ops_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ops_flags" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ordini_arrivo" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_ordini_arrivo" TO "authenticated";
GRANT ALL ON TABLE "public"."v_ordini_arrivo" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_products_to_publish" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_products_to_publish" TO "authenticated";
GRANT ALL ON TABLE "public"."v_products_to_publish" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_reorder" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_reorder" TO "authenticated";
GRANT ALL ON TABLE "public"."v_reorder" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_resi_mensile" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_resi_mensile" TO "authenticated";
GRANT ALL ON TABLE "public"."v_resi_mensile" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_sales_anomalie" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_sales_anomalie" TO "authenticated";
GRANT ALL ON TABLE "public"."v_sales_anomalie" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_shopify_align" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_shopify_align" TO "authenticated";
GRANT ALL ON TABLE "public"."v_shopify_align" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_stock_drift" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."v_stock_drift" TO "authenticated";
GRANT ALL ON TABLE "public"."v_stock_drift" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































