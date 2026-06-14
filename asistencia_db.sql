--
-- PostgreSQL database dump
--

-- Dumped from database version 16.4
-- Dumped by pg_dump version 16.4

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



CREATE TYPE public.estado_asistencia AS ENUM (
    'presente',
    'ausente',
    'justificado'
);


ALTER TYPE public.estado_asistencia OWNER TO postgres;


CREATE TYPE public.estado_justificativo AS ENUM (
    'pendiente',
    'aprobado',
    'rechazado'
);


ALTER TYPE public.estado_justificativo OWNER TO postgres;


CREATE FUNCTION public.fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$BEGIN    NEW.updated_at = CURRENT_TIMESTAMP;    RETURN NEW;END;$$;


ALTER FUNCTION public.fn_set_updated_at() OWNER TO postgres;


CREATE FUNCTION public.fn_validar_revisor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$BEGIN    IF NEW.revisado_por IS NOT NULL THEN        IF NOT EXISTS (            SELECT 1 FROM public.usuarios            WHERE id = NEW.revisado_por              AND rol IN ('profesor', 'secretaria')        ) THEN            RAISE EXCEPTION 'El revisor debe tener rol profesor o secretaria';        END IF;    END IF;    RETURN NEW;END;$$;


ALTER FUNCTION public.fn_validar_revisor() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;


CREATE TABLE public.asistencias (
    id bigint NOT NULL,
    id_clase integer NOT NULL,
    id_estudiante integer NOT NULL,
    estado public.estado_asistencia DEFAULT 'ausente'::public.estado_asistencia NOT NULL,
    fecha_registro timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by integer
);


ALTER TABLE public.asistencias OWNER TO postgres;


CREATE SEQUENCE public.asistencias_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.asistencias_id_seq OWNER TO postgres;


ALTER SEQUENCE public.asistencias_id_seq OWNED BY public.asistencias.id;



CREATE TABLE public.clases (
    id integer NOT NULL,
    id_ramo integer NOT NULL,
    id_seccion integer,
    fecha_hora timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    token_qr character varying(64) NOT NULL,
    expira_at timestamp without time zone NOT NULL,
    estado character varying(20) DEFAULT 'activa'::character varying NOT NULL,
    CONSTRAINT clases_estado_check CHECK (((estado)::text = ANY ((ARRAY['activa'::character varying, 'cerrada'::character varying, 'cancelada'::character varying])::text[])))
);


ALTER TABLE public.clases OWNER TO postgres;


CREATE SEQUENCE public.clases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.clases_id_seq OWNER TO postgres;


ALTER SEQUENCE public.clases_id_seq OWNED BY public.clases.id;



CREATE TABLE public.inscripciones (
    id_estudiante integer NOT NULL,
    id_seccion integer NOT NULL
);


ALTER TABLE public.inscripciones OWNER TO postgres;


CREATE TABLE public.justificativos (
    id integer NOT NULL,
    id_asistencia bigint NOT NULL,
    url_documento character varying(512) NOT NULL,
    mime_type character varying(50) DEFAULT 'application/pdf'::character varying NOT NULL,
    motivo text NOT NULL,
    estado public.estado_justificativo DEFAULT 'pendiente'::public.estado_justificativo NOT NULL,
    revisado_por integer,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.justificativos OWNER TO postgres;


CREATE SEQUENCE public.justificativos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.justificativos_id_seq OWNER TO postgres;


ALTER SEQUENCE public.justificativos_id_seq OWNED BY public.justificativos.id;



CREATE TABLE public.logs_acceso (
    id integer NOT NULL,
    id_usuario integer,
    accion character varying(50) NOT NULL,
    ip character varying(45),
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.logs_acceso OWNER TO postgres;


CREATE SEQUENCE public.logs_acceso_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.logs_acceso_id_seq OWNER TO postgres;


ALTER SEQUENCE public.logs_acceso_id_seq OWNED BY public.logs_acceso.id;



CREATE TABLE public.ramos (
    id integer NOT NULL,
    nombre_ramo character varying(100) NOT NULL,
    id_profesor integer
);


ALTER TABLE public.ramos OWNER TO postgres;


CREATE SEQUENCE public.ramos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ramos_id_seq OWNER TO postgres;


ALTER SEQUENCE public.ramos_id_seq OWNED BY public.ramos.id;



CREATE TABLE public.secciones (
    id integer NOT NULL,
    id_ramo integer NOT NULL,
    id_profesor integer,
    semestre smallint NOT NULL,
    anio smallint NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    CONSTRAINT secciones_semestre_check CHECK ((semestre = ANY (ARRAY[1, 2])))
);


ALTER TABLE public.secciones OWNER TO postgres;


CREATE SEQUENCE public.secciones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.secciones_id_seq OWNER TO postgres;


ALTER SEQUENCE public.secciones_id_seq OWNED BY public.secciones.id;



CREATE TABLE public.tokens_invalidos (
    token text NOT NULL,
    invalidado_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.tokens_invalidos OWNER TO postgres;


CREATE TABLE public.usuarios (
    id integer NOT NULL,
    rut character varying(12) NOT NULL,
    nombre character varying(100) NOT NULL,
    correo character varying(150) NOT NULL,
    password_hash character varying(255) NOT NULL,
    rol character varying(20) NOT NULL,
    CONSTRAINT usuarios_rol_check CHECK (((rol)::text = ANY ((ARRAY['estudiante'::character varying, 'profesor'::character varying, 'secretaria'::character varying])::text[])))
);


ALTER TABLE public.usuarios OWNER TO postgres;


CREATE SEQUENCE public.usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.usuarios_id_seq OWNER TO postgres;


ALTER SEQUENCE public.usuarios_id_seq OWNED BY public.usuarios.id;



ALTER TABLE ONLY public.asistencias ALTER COLUMN id SET DEFAULT nextval('public.asistencias_id_seq'::regclass);



ALTER TABLE ONLY public.clases ALTER COLUMN id SET DEFAULT nextval('public.clases_id_seq'::regclass);



ALTER TABLE ONLY public.justificativos ALTER COLUMN id SET DEFAULT nextval('public.justificativos_id_seq'::regclass);



ALTER TABLE ONLY public.logs_acceso ALTER COLUMN id SET DEFAULT nextval('public.logs_acceso_id_seq'::regclass);



ALTER TABLE ONLY public.ramos ALTER COLUMN id SET DEFAULT nextval('public.ramos_id_seq'::regclass);



ALTER TABLE ONLY public.secciones ALTER COLUMN id SET DEFAULT nextval('public.secciones_id_seq'::regclass);



ALTER TABLE ONLY public.usuarios ALTER COLUMN id SET DEFAULT nextval('public.usuarios_id_seq'::regclass);



ALTER TABLE ONLY public.asistencias
    ADD CONSTRAINT asistencias_id_clase_id_estudiante_key UNIQUE (id_clase, id_estudiante);



ALTER TABLE ONLY public.asistencias
    ADD CONSTRAINT asistencias_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.clases
    ADD CONSTRAINT clases_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.inscripciones
    ADD CONSTRAINT inscripciones_pkey PRIMARY KEY (id_estudiante, id_seccion);



ALTER TABLE ONLY public.justificativos
    ADD CONSTRAINT justificativos_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.logs_acceso
    ADD CONSTRAINT logs_acceso_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.ramos
    ADD CONSTRAINT ramos_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.secciones
    ADD CONSTRAINT secciones_id_ramo_semestre_anio_key UNIQUE (id_ramo, semestre, anio);



ALTER TABLE ONLY public.secciones
    ADD CONSTRAINT secciones_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.tokens_invalidos
    ADD CONSTRAINT tokens_invalidos_pkey PRIMARY KEY (token);



ALTER TABLE ONLY public.justificativos
    ADD CONSTRAINT un_justificativo_por_asistencia UNIQUE (id_asistencia);



ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_correo_key UNIQUE (correo);



ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);



ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_rut_key UNIQUE (rut);



CREATE INDEX idx_asistencias_clase ON public.asistencias USING btree (id_clase);



CREATE INDEX idx_asistencias_estudiante ON public.asistencias USING btree (id_estudiante);



CREATE INDEX idx_clases_token_qr ON public.clases USING btree (token_qr);


CREATE INDEX idx_justificativos_estado ON public.justificativos USING btree (estado);


CREATE TRIGGER trg_asistencias_updated_at BEFORE UPDATE ON public.asistencias FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();



CREATE TRIGGER trg_validar_revisor BEFORE INSERT OR UPDATE ON public.justificativos FOR EACH ROW EXECUTE FUNCTION public.fn_validar_revisor();



ALTER TABLE ONLY public.asistencias
    ADD CONSTRAINT asistencias_id_clase_fkey FOREIGN KEY (id_clase) REFERENCES public.clases(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.asistencias
    ADD CONSTRAINT asistencias_id_estudiante_fkey FOREIGN KEY (id_estudiante) REFERENCES public.usuarios(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.asistencias
    ADD CONSTRAINT asistencias_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.usuarios(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.clases
    ADD CONSTRAINT clases_id_ramo_fkey FOREIGN KEY (id_ramo) REFERENCES public.ramos(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.clases
    ADD CONSTRAINT clases_id_seccion_fkey FOREIGN KEY (id_seccion) REFERENCES public.secciones(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.inscripciones
    ADD CONSTRAINT inscripciones_id_estudiante_fkey FOREIGN KEY (id_estudiante) REFERENCES public.usuarios(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.inscripciones
    ADD CONSTRAINT inscripciones_id_seccion_fkey FOREIGN KEY (id_seccion) REFERENCES public.secciones(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.justificativos
    ADD CONSTRAINT justificativos_id_asistencia_fkey FOREIGN KEY (id_asistencia) REFERENCES public.asistencias(id) ON DELETE CASCADE;



ALTER TABLE ONLY public.justificativos
    ADD CONSTRAINT justificativos_revisado_por_fkey FOREIGN KEY (revisado_por) REFERENCES public.usuarios(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.logs_acceso
    ADD CONSTRAINT logs_acceso_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.ramos
    ADD CONSTRAINT ramos_id_profesor_fkey FOREIGN KEY (id_profesor) REFERENCES public.usuarios(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.secciones
    ADD CONSTRAINT secciones_id_profesor_fkey FOREIGN KEY (id_profesor) REFERENCES public.usuarios(id) ON DELETE SET NULL;



ALTER TABLE ONLY public.secciones
    ADD CONSTRAINT secciones_id_ramo_fkey FOREIGN KEY (id_ramo) REFERENCES public.ramos(id) ON DELETE CASCADE;


