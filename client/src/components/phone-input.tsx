import * as React from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { deduplicatedCountryCodes } from "@/lib/phone-utils"
import { cn } from "@/lib/utils"

interface PhoneInputProps {
  countryCode?: string
  phoneNumber?: string
  onCountryCodeChange?: (code: string) => void
  onPhoneNumberChange?: (number: string) => void
  countryCodeLabel?: string
  phoneNumberLabel?: string
  phoneNumberPlaceholder?: string
  className?: string
  containerClassName?: string
  disabled?: boolean
}

const PhoneInput = React.forwardRef<
  HTMLInputElement,
  PhoneInputProps
>(
  (
    {
      countryCode = "",
      phoneNumber = "",
      onCountryCodeChange,
      onPhoneNumberChange,
      countryCodeLabel = "Country",
      phoneNumberLabel = "Phone Number",
      phoneNumberPlaceholder = "8012345678",
      className,
      containerClassName,
      disabled = false,
    },
    ref
  ) => {
    return (
      <div className={cn("grid grid-cols-1 sm:grid-cols-5 gap-3", containerClassName)}>
        <div className="sm:col-span-2">
          {countryCodeLabel && (
            <Label className="text-xs text-muted-foreground mb-2 block">
              {countryCodeLabel}
            </Label>
          )}
          <Select value={countryCode} onValueChange={onCountryCodeChange} disabled={disabled}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select country" />
            </SelectTrigger>
            <SelectContent>
              {deduplicatedCountryCodes.map((country) => (
                <SelectItem key={country.dialCode} value={country.dialCode}>
                  {country.dialCode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="sm:col-span-3">
          {phoneNumberLabel && (
            <Label className="text-xs text-muted-foreground mb-2 block">
              {phoneNumberLabel}
            </Label>
          )}
          <Input
            ref={ref}
            type="tel"
            placeholder={phoneNumberPlaceholder}
            value={phoneNumber}
            onChange={(e) => onPhoneNumberChange?.(e.target.value)}
            className={cn("h-9", className)}
            disabled={disabled}
          />
        </div>
      </div>
    )
  }
)

PhoneInput.displayName = "PhoneInput"

export { PhoneInput }
