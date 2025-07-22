
import * as React from "react"
import { useState, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface SearchableSelectProps {
  value?: string
  onValueChange: (value: string) => void
  placeholder?: string
  options: { value: string; label: string }[]
  className?: string
  id?: string // Add unique ID prop
}

export const SearchableSelect = React.forwardRef<
  HTMLDivElement,
  SearchableSelectProps
>(({ value, onValueChange, placeholder, options, className, id }, ref) => {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [filteredOptions, setFilteredOptions] = useState(options)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const uniqueId = React.useMemo(() => id || `searchable-select-${Math.random().toString(36).substr(2, 9)}`, [id])

  const calculatePosition = React.useCallback(() => {
    if (!containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    const dropdownHeight = 400 // Approximate max height
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop
    const scrollLeft = document.documentElement.scrollLeft || document.body.scrollLeft

    // Calculate position relative to viewport, then add scroll position
    let top = rect.bottom + scrollTop + 4
    let left = rect.left + scrollLeft
    let width = rect.width

    // Check if dropdown would go off the bottom of screen
    if (rect.bottom + dropdownHeight > viewportHeight) {
      // Position above if there's enough space
      if (rect.top > dropdownHeight) {
        top = rect.top + scrollTop - dropdownHeight - 4
      }
    }

    // Check if dropdown would go off the right side
    if (rect.left + width > viewportWidth) {
      left = viewportWidth - width + scrollLeft - 20
    }

    // Ensure minimum left position
    if (left < scrollLeft + 10) {
      left = scrollLeft + 10
    }

    return { top, left, width }
  }, [])

  useEffect(() => {
    const filtered = options.filter(option =>
      option.label.toLowerCase().includes(searchTerm.toLowerCase())
    )
    setFilteredOptions(filtered)
  }, [searchTerm, options])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        // Check if the click is on THIS dropdown's portal
        const target = event.target as Element;
        if (!target.closest(`[data-dropdown-id="${uniqueId}"]`)) {
          setIsOpen(false)
          setSearchTerm("")
        }
      }
    }

    const handleResize = () => {
      if (isOpen && containerRef.current) {
        const position = calculatePosition()
        if (position) {
          setDropdownPosition(position)
        }
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      window.addEventListener('resize', handleResize)
      window.addEventListener('scroll', handleResize, true)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        window.removeEventListener('resize', handleResize)
        window.removeEventListener('scroll', handleResize, true)
      }
    }
  }, [isOpen, uniqueId, calculatePosition])

  const selectedOption = options.find(option => option.value === value)

  const handleToggle = () => {
    if (isOpen) {
      setIsOpen(false)
      setSearchTerm("")
      return
    }
    
    // Close any other open dropdowns
    document.querySelectorAll('[data-dropdown-id]').forEach((dropdown) => {
      if (dropdown.getAttribute('data-dropdown-id') !== uniqueId) {
        // Trigger a click outside event for other dropdowns
        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      }
    })
    
    // Calculate position and open dropdown
    const position = calculatePosition()
    if (position) {
      setDropdownPosition(position)
      setIsOpen(true)
      
      // Focus input after a short delay
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  const handleSelect = (optionValue: string) => {
    onValueChange(optionValue)
    setIsOpen(false)
    setSearchTerm("")
  }

  return (
    <div ref={containerRef} className={cn("relative isolate", className)}>
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
        <ChevronDown className="h-4 w-4 opacity-50" />
      </div>

      {isOpen && createPortal(
        <div 
          ref={dropdownRef}
          data-dropdown-id={uniqueId}
          className="fixed z-[999999] max-h-96 overflow-hidden rounded-md border bg-slate-800 border-slate-700 text-gray-200 shadow-2xl shadow-slate-900/50 backdrop-blur-sm animate-in fade-in-0 zoom-in-95 duration-150"
          style={{
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            width: `${dropdownPosition.width}px`,
            maxWidth: '400px',
            minWidth: '200px'
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
                    "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-slate-700",
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
        </div>,
        document.body
      )}
    </div>
  )
})

SearchableSelect.displayName = "SearchableSelect"
