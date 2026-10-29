export type SellerInformation = {
  name: string
  representative: string
  address: string
  phone: string
  email: string
  contact_disclosure_mode?: 'public' | 'on_request' | 'unconfigured'
  contact_disclosure_ready?: boolean
}

export const isSellerInformationComplete = (seller: SellerInformation) => {
  if (![seller.name, seller.representative, seller.email].every(value => value.trim().length > 0)) return false

  switch (seller.contact_disclosure_mode ?? 'public') {
    case 'public':
      return [seller.address, seller.phone].every(value => value.trim().length > 0)
    case 'on_request':
      return seller.contact_disclosure_ready === true
    default:
      return false
  }
}
