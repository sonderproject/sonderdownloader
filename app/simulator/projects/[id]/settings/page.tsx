"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Shell } from "../../../ui";
import { Project, Property, Visibility, CTA_LABEL } from "@/lib/spatial/types";
import { store } from "@/lib/spatial/store";

const fieldCls =
  "w-full px-3 py-2 bg-black/25 border border-white/10 rounded-sonder text-text placeholder:text-text-subtle font-sans text-sm focus:outline-none focus:border-accent/60 transition";

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="microlabel text-[9px] block mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={fieldCls}
      />
    </div>
  );
}

export default function SettingsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    setProject(store.get(id));
  }, [id]);

  if (!project) return <Shell>{null}</Shell>;

  function patch(p: Partial<Project>) {
    const next = store.update(project!.id, p);
    if (next) setProject(next);
  }

  function patchProperty(p: Partial<Property>) {
    patch({ property: { ...project!.property, ...p } });
  }

  function handleDelete() {
    if (!confirm(`Delete "${project!.title}"? This cannot be undone.`)) return;
    store.remove(project!.id);
    router.push("/simulator/dashboard");
  }

  return (
    <Shell>
      <Link
        href={`/simulator/projects/${project.id}`}
        className="microlabel hover:text-accent-bright transition no-underline"
      >
        ← {project.title}
      </Link>
      <h1 className="mt-4 font-display text-text text-3xl md:text-5xl font-medium leading-tight mb-10">
        Settings
      </h1>

      <div className="max-w-2xl flex flex-col gap-8">
        <div className="glass p-6">
          <p className="microlabel mb-4">Project</p>
          <div className="grid md:grid-cols-2 gap-3">
            <Field
              label="Title"
              value={project.title}
              onChange={(v) => patch({ title: v })}
            />
            <Field
              label="Address"
              value={project.address ?? ""}
              onChange={(v) => patch({ address: v })}
            />
          </div>
        </div>

        <div className="glass p-6">
          <p className="microlabel mb-4">Property info</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field
              label="Price"
              value={project.property.price ?? ""}
              onChange={(v) => patchProperty({ price: v })}
              placeholder="$1,250,000"
            />
            <Field
              label="Beds"
              value={project.property.beds ?? ""}
              onChange={(v) => patchProperty({ beds: v })}
            />
            <Field
              label="Baths"
              value={project.property.baths ?? ""}
              onChange={(v) => patchProperty({ baths: v })}
            />
            <Field
              label="Sq Ft"
              value={project.property.squareFeet ?? ""}
              onChange={(v) => patchProperty({ squareFeet: v })}
            />
          </div>
        </div>

        <div className="glass p-6">
          <p className="microlabel mb-4">Agent / client</p>
          <div className="grid md:grid-cols-3 gap-3">
            <Field
              label="Name"
              value={project.property.agentName ?? ""}
              onChange={(v) => patchProperty({ agentName: v })}
            />
            <Field
              label="Phone"
              value={project.property.agentPhone ?? ""}
              onChange={(v) => patchProperty({ agentPhone: v })}
            />
            <Field
              label="Email"
              value={project.property.agentEmail ?? ""}
              onChange={(v) => patchProperty({ agentEmail: v })}
            />
          </div>
        </div>

        <div className="glass p-6">
          <p className="microlabel mb-4">CTA &amp; visibility</p>
          <div className="grid md:grid-cols-2 gap-3 mb-4">
            <Field
              label="CTA label"
              value={project.ctaLabel ?? ""}
              onChange={(v) => patch({ ctaLabel: v })}
              placeholder={CTA_LABEL[project.projectType]}
            />
          </div>
          <div className="flex gap-1">
            {(["private", "unlisted", "public"] as Visibility[]).map((v) => (
              <button
                key={v}
                onClick={() => patch({ visibility: v })}
                className={`px-3 py-2 text-xs uppercase tracking-widest rounded-sonder border transition ${
                  project.visibility === v
                    ? "border-accent text-text bg-accent/20"
                    : "border-white/15 text-text-dim hover:text-text"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div>
          <button
            onClick={handleDelete}
            className="microlabel text-[10px] opacity-50 hover:opacity-100 hover:text-red-300 transition"
          >
            Delete project
          </button>
        </div>
      </div>
    </Shell>
  );
}
