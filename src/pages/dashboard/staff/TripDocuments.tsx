// TripDocuments: the documents (delivery order / DO, photos, PDFs) attached
// to ONE trip (itinerary). Files live in the private Storage bucket
// `trip-documents` under "<itinerary_id>/<file>", and each file has a row
// in `itinerary_documents`. Staff pass canEdit to upload/delete; drivers
// and clients get the same list read-only (RLS decides who can see what).
//
// Built for phones: "Take photo" opens the back camera directly, several
// files can be picked at once (or dragged in on a computer), and photos
// are shrunk in the browser before upload (a 6 MB phone photo becomes
// ~500 KB -- fast on mobile data, never near the 10 MB limit). PDFs are
// uploaded as-is. Private bucket -> thumbnails and "open" use signed links.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { showToast } from '../../../components/Toast'
import { confirmDialog } from '../../../components/ConfirmDialog'
import EmptyState from '../../../components/EmptyState'

const BUCKET = 'trip-documents'
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB per file (the bucket enforces it too)
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const MAX_PHOTO_SIDE = 2000 // px -- still sharp enough to read a DO

type Doc = { document_id: number; file_path: string; file_name: string; file_type: string | null }

// A file being uploaded right now, or one that failed (kept so it can be retried).
type Pending = { key: string; file: File; failed: string | null }

// Shrinks a photo to at most MAX_PHOTO_SIDE px and re-saves it as JPEG.
// Falls back to the original if the browser can't read it or it wouldn't
// get smaller.
async function shrinkPhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file) // also applies the phone's rotation
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    if (!blob || blob.size >= file.size) return file
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

// Time + random bit: unique enough for a storage file name / list key.
function uniqueKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

// Loads a trip's documents plus signed thumbnail links for the images
// (one call for all of them, links last an hour). null = couldn't load.
async function fetchDocs(itineraryId: number) {
  const { data, error } = await supabase
    .from('itinerary_documents')
    .select('document_id, file_path, file_name, file_type')
    .eq('itinerary_id', itineraryId)
    .order('uploaded_at', { ascending: true })
  if (error) return null
  const docs: Doc[] = data ?? []

  const thumbs: Record<string, string> = {}
  const imagePaths = docs.filter((d) => d.file_type?.startsWith('image/')).map((d) => d.file_path)
  if (imagePaths.length > 0) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(imagePaths, 3600)
    for (const s of signed ?? []) if (s.path && s.signedUrl) thumbs[s.path] = s.signedUrl
  }
  return { docs, thumbs }
}

// Uploads one file to a trip. Returns an error message, or null when it worked.
async function uploadOne(itineraryId: number, original: File): Promise<string | null> {
  if (!ALLOWED_TYPES.includes(original.type)) return 'Only PDF, JPG, PNG or WebP files.'
  const file = await shrinkPhoto(original)
  if (file.size > MAX_BYTES) return 'File is over 10 MB.'

  // Storage keys must be plain characters; the original name is kept in the table.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${itineraryId}/${uniqueKey()}-${safeName}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type })
  if (uploadError) return uploadError.message

  const { error: rowError } = await supabase.from('itinerary_documents').insert({
    itinerary_id: itineraryId,
    file_path: path,
    file_name: file.name,
    file_type: file.type,
  })
  if (rowError) {
    // Don't leave an orphan file behind with no row pointing to it.
    await supabase.storage.from(BUCKET).remove([path])
    return rowError.message
  }
  return null
}

export default function TripDocuments({
  itineraryId,
  canEdit = false,
  onCountChange,
}: {
  itineraryId: number
  canEdit?: boolean
  // Told the new number of documents after every load (for count labels
  // elsewhere). Pass a stable function (useCallback) -- it reloads if it changes.
  onCountChange?: (itineraryId: number, count: number) => void
}) {
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [loadFailed, setLoadFailed] = useState(false)
  const [pending, setPending] = useState<Pending[]>([])
  const [dragOver, setDragOver] = useState(false)

  const load = useCallback(() => {
    fetchDocs(itineraryId).then((result) => {
      if (!result) {
        setLoadFailed(true)
        return
      }
      setDocs(result.docs)
      setThumbs(result.thumbs)
      onCountChange?.(itineraryId, result.docs.length)
    })
  }, [itineraryId, onCountChange])

  useEffect(() => {
    load()
  }, [load])

  // Uploads files side by side; each one shows its own progress/failure.
  async function uploadMany(files: File[]) {
    const batch = files.map((file) => ({ key: uniqueKey(), file, failed: null }))
    setPending((p) => [...p, ...batch])
    await Promise.all(
      batch.map(async (item) => {
        const error = await uploadOne(itineraryId, item.file)
        setPending((p) =>
          error
            ? p.map((x) => (x.key === item.key ? { ...x, failed: error } : x))
            : p.filter((x) => x.key !== item.key),
        )
      }),
    )
    load()
  }

  function retry(item: Pending) {
    setPending((p) => p.filter((x) => x.key !== item.key))
    uploadMany([item.file])
  }

  async function handleOpen(doc: Doc) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 60)
    if (error || !data) {
      showToast("Couldn't open that document.", 'error')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function handleDelete(doc: Doc) {
    if (!(await confirmDialog({ message: `Delete "${doc.file_name}"?`, danger: true }))) return
    // Row first, with .select() so a silent RLS no-op is caught.
    const { data, error } = await supabase
      .from('itinerary_documents')
      .delete()
      .eq('document_id', doc.document_id)
      .select()
      .maybeSingle()
    if (error || !data) {
      showToast("Couldn't delete that document.", 'error')
      return
    }
    await supabase.storage.from(BUCKET).remove([doc.file_path])
    load()
  }

  // Shared by both file inputs: grab the picked files, then reset the input
  // so picking the same file again still fires.
  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length > 0) uploadMany(files)
  }

  if (loadFailed) return <p className="text-sm text-red-600">Documents couldn't be loaded.</p>

  return (
    <div className="text-sm">
      {canEdit && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const files = Array.from(e.dataTransfer.files)
            if (files.length > 0) uploadMany(files)
          }}
          className={`border-2 border-dashed p-4 text-center ${
            dragOver ? 'border-slate-500 bg-slate-100' : 'border-slate-300 bg-slate-50'
          }`}
        >
          <div className="flex flex-wrap justify-center gap-2">
            <label className="btn-primary cursor-pointer px-4 py-2 font-medium">
              Take photo
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
            </label>
            <label className="cursor-pointer border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100">
              Choose files
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={onPick}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            or drag files here · PDF, JPG, PNG or WebP · up to 10 MB each
          </p>
        </div>
      )}

      {pending.length > 0 && (
        <ul className="mt-3 grid gap-1">
          {pending.map((item) => (
            <li key={item.key} className="flex items-center gap-2 text-xs">
              <span className="truncate text-slate-700">{item.file.name}</span>
              {item.failed ? (
                <>
                  <span className="text-red-600">— {item.failed}</span>
                  <button type="button" onClick={() => retry(item)} className="font-medium underline">
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => setPending((p) => p.filter((x) => x.key !== item.key))}
                    className="text-slate-500 underline"
                  >
                    Dismiss
                  </button>
                </>
              ) : (
                <span className="text-slate-500">Uploading…</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {docs === null ? (
        <p className="mt-3 text-slate-500">Loading documents…</p>
      ) : docs.length === 0 ? (
        <EmptyState message="No documents yet." className="mt-3" />
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {docs.map((doc) => (
            <div key={doc.document_id} className="min-w-0">
              <button
                type="button"
                onClick={() => handleOpen(doc)}
                title={`Open ${doc.file_name}`}
                className="flex aspect-square w-full items-center justify-center overflow-hidden border border-slate-200 bg-slate-50 hover:border-slate-400"
              >
                {thumbs[doc.file_path] ? (
                  <img src={thumbs[doc.file_path]} alt={doc.file_name} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs font-semibold text-slate-500">
                    {doc.file_type === 'application/pdf' ? 'PDF' : 'File'}
                  </span>
                )}
              </button>
              <p className="mt-1 truncate text-xs text-slate-600" title={doc.file_name}>
                {doc.file_name}
              </p>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => handleDelete(doc)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
