import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { MAX_FILE_BYTES, TEMPLATE_COLUMNS } from "@/lib/buildings-template";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const buildingsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["buildings", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("buildings")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

export const Route = createFileRoute("/_authenticated/buildings")({
  head: () => ({
    meta: [
      { title: "Buildings — Buildings Registry" },
      { name: "description", content: "Your buildings list with Excel import." },
      { property: "og:title", content: "Buildings — Buildings Registry" },
      { property: "og:description", content: "Your buildings list with Excel import." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(buildingsQuery(context.user.id)),
  component: BuildingsPage,
});

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    [...TEMPLATE_COLUMNS],
    ["Example Tower", "1 Main St", "Athens", "Greece", 12, 1998],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Buildings");
  XLSX.writeFile(wb, "buildings-template.xlsx");
}

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function BuildingsPage() {
  const { user } = Route.useRouteContext();
  const { data: buildings } = useSuspenseQuery(buildingsQuery(user.id));
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name) || !file.size || file.size > MAX_FILE_BYTES) {
      toast.error("Choose an .xlsx, .xls or .csv file up to 10 MiB.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const { data: res, error } = await supabase.functions.invoke<{
        inserted: number;
        skipped: number;
      }>("import-buildings", {
        body: {
          fileBase64: toBase64(await file.arrayBuffer()),
        },
      });

      if (error) throw error;
      if (
        !res ||
        !Number.isInteger(res.inserted) ||
        res.inserted < 0 ||
        !Number.isInteger(res.skipped) ||
        res.skipped < 0
      ) {
        throw new Error("Invalid response from import function");
      }
      toast.success(
        `Imported ${res.inserted} buildings${res.skipped ? `, skipped ${res.skipped} without a name` : ""}.`,
      );
      await qc.invalidateQueries({ queryKey: ["buildings"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Buildings</h1>
          <p className="text-sm text-muted-foreground">{buildings.length} total</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadTemplate}>
            Download Excel template
          </Button>
          <Button disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Importing…" : "Import Excel"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Country</TableHead>
              <TableHead className="text-right">Floors</TableHead>
              <TableHead className="text-right">Year built</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buildings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No buildings yet. Download the template, fill it in and import it.
                </TableCell>
              </TableRow>
            ) : (
              buildings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell>{b.address}</TableCell>
                  <TableCell>{b.city}</TableCell>
                  <TableCell>{b.country}</TableCell>
                  <TableCell className="text-right">{b.floors}</TableCell>
                  <TableCell className="text-right">{b.year_built}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
