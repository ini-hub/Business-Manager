export function getUserFriendlyError(error: Error | unknown, context?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  
  if (
    message.toLowerCase().includes("store creation failed") ||
    message.toLowerCase().includes("store update failed") ||
    message.toLowerCase().includes("cannot create store") ||
    message.toLowerCase().includes("cannot update store") ||
    message.toLowerCase().includes("already exists") ||
    message.toLowerCase().includes("taken") ||
    message.toLowerCase().includes("already in use")
  ) {
    return message
      .replace(/^Store Creation Failed:\s*/i, "")
      .replace(/^Store Update Failed:\s*/i, "")
      .replace(/^Cannot create store:\s*/i, "")
      .replace(/^Cannot update store:\s*/i, "");
  }
  
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

  // Handle email already in use errors. Matches on "email address" rather
  // than the bare word "email" - a conflict message about something else
  // entirely (e.g. a mobile number) can still mention "email" in passing
  // ("...or check if this staff member already has an account under a
  // different email"), which used to get wrongly reclassified as an email
  // conflict here instead of showing its own, correct message.
  if (message.toLowerCase().includes("email address") &&
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

  if (message.toLowerCase().includes("cannot be sold for ₦0") || message.toLowerCase().includes("only active promotions can apply")) {
    return "Items cannot be priced at ₦0 during checkout unless covered by an active promotion.";
  }

  // Last resort before genericizing: this app's own route handlers already
  // write complete, user-facing guidance for expected conflicts (e.g. "...
  // Please use a different number."), which is a shape opaque driver/DB
  // errors never take. Showing that verbatim beats replacing a specific,
  // actionable message with a generic one just because it didn't match any
  // pattern above.
  if (/\bplease\b/i.test(message) && message.length < 300) {
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
