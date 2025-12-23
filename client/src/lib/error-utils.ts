export function getUserFriendlyError(error: Error | unknown, context?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  
  const errorMappings: Record<string, string> = {
    "Failed to fetch": "Unable to connect to the server. Please check your internet connection and try again.",
    "Network Error": "Unable to connect to the server. Please check your internet connection and try again.",
    "Failed to fetch customers": "We couldn't load your customers. Please refresh the page and try again.",
    "Failed to fetch staff": "We couldn't load your staff members. Please refresh the page and try again.",
    "Failed to fetch inventory": "We couldn't load your inventory. Please refresh the page and try again.",
    "Failed to fetch transactions": "We couldn't load your transactions. Please refresh the page and try again.",
    "Customer not found": "This customer no longer exists. It may have been deleted.",
    "Staff member not found": "This staff member no longer exists. They may have been removed.",
    "Inventory item not found": "This item no longer exists. It may have been deleted.",
    "Invalid data format": "The data format is incorrect. Please check your input and try again.",
    "Failed to create customer": "We couldn't add this customer. Please check the information and try again.",
    "Failed to update customer": "We couldn't update this customer. Please try again.",
    "Failed to delete customer": "We couldn't remove this customer. Please try again.",
    "Failed to create staff member": "We couldn't add this staff member. Please check the information and try again.",
    "Failed to update staff member": "We couldn't update this staff member. Please try again.",
    "Failed to delete staff member": "We couldn't remove this staff member. Please try again.",
    "Failed to create inventory item": "We couldn't add this item. Please check the information and try again.",
    "Failed to update inventory item": "We couldn't update this item. Please try again.",
    "Failed to delete inventory item": "We couldn't remove this item. Please try again.",
    "Failed to process checkout": "We couldn't complete this sale. Please try again.",
    "Failed to import": "We couldn't import your data. Please check the file format and try again.",
  };

  for (const [key, friendlyMessage] of Object.entries(errorMappings)) {
    if (message.toLowerCase().includes(key.toLowerCase())) {
      return friendlyMessage;
    }
  }

  // Handle email already in use errors
  if (message.toLowerCase().includes("email") && 
      (message.toLowerCase().includes("already") || message.toLowerCase().includes("in use") || message.toLowerCase().includes("exists"))) {
    if (context === "staff") {
      return "This email address is already in use. Please use a different email.";
    }
    return message; // Use the server's message for signup/login errors
  }

  if (message.includes("unique constraint") || message.includes("duplicate")) {
    if (context === "customer") {
      return "A customer with this number already exists. Please use a different customer number.";
    }
    if (context === "staff") {
      return "A staff member with this number already exists. Please use a different staff number.";
    }
    return "This record already exists. Please use different information.";
  }

  if (message.includes("foreign key") || message.includes("reference")) {
    return "This record is linked to other data and cannot be modified this way.";
  }

  if (message.includes("validation") || message.includes("required")) {
    return "Please fill in all required fields correctly.";
  }

  if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
    return "The request took too long. Please try again.";
  }

  if (message.startsWith("Cannot delete")) {
    return message;
  }

  if (message.startsWith("Insufficient stock")) {
    return message;
  }

  if (context) {
    return `Something went wrong while ${context}. Please try again.`;
  }

  return "Something went wrong. Please try again or contact support if the problem persists.";
}

export function formatValidationErrors(errors: Array<{ path?: string[]; message: string }>): string {
  if (!errors || errors.length === 0) {
    return "Please check your input and try again.";
  }

  const fieldMessages = errors.map((err) => {
    const field = err.path?.[0] || "field";
    const fieldName = formatFieldName(field);
    return `${fieldName}: ${err.message}`;
  });

  if (fieldMessages.length === 1) {
    return fieldMessages[0];
  }

  return `Please fix the following: ${fieldMessages.join(", ")}`;
}

function formatFieldName(field: string): string {
  const fieldMappings: Record<string, string> = {
    name: "Name",
    customerNumber: "Customer Number",
    staffNumber: "Staff Number",
    mobileNumber: "Mobile Number",
    address: "Address",
    payPerMonth: "Monthly Pay",
    signedContract: "Contract Status",
    costPrice: "Cost Price",
    sellingPrice: "Selling Price",
    quantity: "Quantity",
    type: "Type",
  };

  return fieldMappings[field] || field.charAt(0).toUpperCase() + field.slice(1).replace(/([A-Z])/g, " $1");
}
