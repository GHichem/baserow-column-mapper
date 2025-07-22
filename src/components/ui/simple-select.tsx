import * as React from "react"
import { useState, useEffect, useRef } from "react"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface SimpleSelectProps {
  value?: string
  onValueChange: (value: string) => void
  placeholder?: string
  options: { value: string; label: string }[]
  className?: string
  id?: string
}

export const SimpleSelect = React.forwardRef<
  HTMLDivElement,
  SimpleSelectProps
>(({ value, onValueChange, placeholder, options, className, id }, ref) => {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [filteredOptions, setFilteredOptions] = useState(options)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const filtered = options.filter(option =>
      option.label.toLowerCase().includes(searchTerm.toLowerCase())
    )
    setFilteredOptions(filtered)
  }, [searchTerm, options])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setSearchTerm("")
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const selectedOption = options.find(option => option.value === value)

  const handleToggle = () => {
    // Close other dropdowns first
    document.querySelectorAll('[data-simple-select]').forEach((dropdown) => {
      if (dropdown !== containerRef.current) {
        (dropdown as any)._close?.()
      }
    })

    setIsOpen(!isOpen)
    if (!isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setSearchTerm("")
    }
  }

  const handleSelect = (optionValue: string) => {
    onValueChange(optionValue)
    setIsOpen(false)
    setSearchTerm("")
  }

  // Expose close function for other instances
  React.useEffect(() => {
    if (containerRef.current) {
      (containerRef.current as any)._close = () => {
        setIsOpen(false)
        setSearchTerm("")
      }
    }
  }, [])

  return (
    <div 
      ref={containerRef} 
      className={cn("relative isolate z-10", className)}
      data-simple-select
      style={{ zIndex: isOpen ? 9999 : 'auto' }}
    >
      <div
        ref={ref}
        onClick={handleToggle}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer bg-slate-700/50 border-slate-600 text-white hover:bg-slate-600/50 hover:border-slate-500 transition-all duration-200",
          className
        )}
      >
        <span className={cn("truncate", !selectedOption && "text-gray-400")}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform duration-200", isOpen && "rotate-180")} />
      </div>

      {isOpen && (
        <div 
          className="absolute z-[9999] top-full left-0 mt-2 max-h-96 w-full overflow-hidden rounded-md border bg-slate-800 border-slate-700 text-gray-200 shadow-2xl shadow-slate-900/50 backdrop-blur-sm animate-in fade-in-0 zoom-in-95 duration-150"
          style={{ 
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(148, 163, 184, 0.1)' 
          }}
        >
          <div className="p-2 border-b border-slate-700">
            <input
              ref={inputRef}
              type="text"
              placeholder="Suchen..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-2 py-1 text-sm border border-slate-600 rounded bg-slate-700 text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
            />
          </div>
          <div className="max-h-[300px] overflow-auto p-1">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <div
                  key={option.value}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(option.value);
                  }}
                  className={cn(
                    "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-slate-700 transition-colors",
                    value === option.value && "bg-slate-700 text-white"
                  )}
                >
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    {value === option.value && <Check className="h-4 w-4 text-purple-400" />}
                  </span>
                  {option.label}
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-sm text-gray-500">
                Keine Ergebnisse gefunden
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

SimpleSelect.displayName = "SimpleSelect"
