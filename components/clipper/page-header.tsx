export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <header className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b px-6 py-3">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-xs text-muted-foreground text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}
