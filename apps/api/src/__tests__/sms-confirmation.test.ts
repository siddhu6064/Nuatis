import { buildConfirmationSms } from '../lib/sms-templates.js'

const DT = 'Monday, April 27 at 10:00 AM'

describe('buildConfirmationSms — with datetime', () => {
  // CLINICAL
  test('dental + name', () => {
    expect(
      buildConfirmationSms({
        contactName: 'Alice',
        businessName: 'Smile Dental',
        appointmentDateTime: DT,
        vertical: 'dental',
      })
    ).toBe(
      `Hi Alice, your appointment with Smile Dental is confirmed for ${DT}. Reply CANCEL to cancel.`
    )
  })

  test('medical no name', () => {
    expect(
      buildConfirmationSms({
        businessName: 'City Medical',
        appointmentDateTime: DT,
        vertical: 'medical',
      })
    ).toBe(`Your appointment with City Medical is confirmed for ${DT}. Reply CANCEL to cancel.`)
  })

  test('vet + name', () => {
    expect(
      buildConfirmationSms({
        contactName: 'Bob',
        businessName: 'Paws Vet',
        appointmentDateTime: DT,
        vertical: 'vet',
      })
    ).toBe(`Hi Bob, your appointment with Paws Vet is confirmed for ${DT}. Reply CANCEL to cancel.`)
  })

  // SERVICE
  test('salon + name', () => {
    expect(
      buildConfirmationSms({
        contactName: 'Carol',
        businessName: 'Glam Salon',
        appointmentDateTime: DT,
        vertical: 'salon',
      })
    ).toBe(`Hi Carol, your booking at Glam Salon is confirmed for ${DT}. Reply CANCEL to cancel.`)
  })

  test('gym no name', () => {
    expect(
      buildConfirmationSms({ businessName: 'Iron Gym', appointmentDateTime: DT, vertical: 'gym' })
    ).toBe(`Your booking at Iron Gym is confirmed for ${DT}. Reply CANCEL to cancel.`)
  })

  test('pet_grooming + name', () => {
    expect(
      buildConfirmationSms({
        contactName: 'Dave',
        businessName: 'Fluffy Grooming',
        appointmentDateTime: DT,
        vertical: 'pet_grooming',
      })
    ).toBe(
      `Hi Dave, your booking at Fluffy Grooming is confirmed for ${DT}. Reply CANCEL to cancel.`
    )
  })

  // HOSPITALITY
  test('restaurant', () => {
    expect(
      buildConfirmationSms({
        businessName: 'Bistro 42',
        appointmentDateTime: DT,
        vertical: 'restaurant',
      })
    ).toBe(`Your reservation at Bistro 42 is confirmed for ${DT}.`)
  })

  // PROFESSIONAL
  test('law_firm', () => {
    expect(
      buildConfirmationSms({
        businessName: 'Smith & Co',
        appointmentDateTime: DT,
        vertical: 'law_firm',
      })
    ).toBe(`Your appointment with Smith & Co is confirmed for ${DT}.`)
  })

  // Default fallback
  test('unknown vertical', () => {
    expect(
      buildConfirmationSms({ businessName: 'Acme', appointmentDateTime: DT, vertical: 'unknown' })
    ).toBe(`Your appointment with Acme is confirmed for ${DT}. Reply CANCEL to cancel.`)
  })
})

describe('buildConfirmationSms — generic (no datetime, maya_only)', () => {
  test('dental + name', () => {
    expect(
      buildConfirmationSms({
        contactName: 'Alice',
        businessName: 'Smile Dental',
        vertical: 'dental',
      })
    ).toBe(
      'Hi Alice, your appointment with Smile Dental has been booked. We look forward to seeing you! Reply CANCEL to cancel.'
    )
  })

  test('dental no name', () => {
    expect(buildConfirmationSms({ businessName: 'Smile Dental', vertical: 'dental' })).toBe(
      'Your appointment with Smile Dental has been booked. We look forward to seeing you! Reply CANCEL to cancel.'
    )
  })

  test('salon + name', () => {
    expect(
      buildConfirmationSms({ contactName: 'Carol', businessName: 'Glam Salon', vertical: 'salon' })
    ).toBe(
      'Hi Carol, your booking at Glam Salon is confirmed. See you soon! Reply CANCEL to cancel.'
    )
  })

  test('salon no name', () => {
    expect(buildConfirmationSms({ businessName: 'Glam Salon', vertical: 'salon' })).toBe(
      'Your booking at Glam Salon is confirmed. See you soon! Reply CANCEL to cancel.'
    )
  })

  test('restaurant', () => {
    expect(buildConfirmationSms({ businessName: 'Bistro 42', vertical: 'restaurant' })).toBe(
      'Your reservation at Bistro 42 is confirmed.'
    )
  })

  test('law_firm', () => {
    expect(buildConfirmationSms({ businessName: 'Smith & Co', vertical: 'law_firm' })).toBe(
      'Your appointment with Smith & Co is confirmed.'
    )
  })

  test('unknown vertical fallback', () => {
    expect(buildConfirmationSms({ businessName: 'Acme', vertical: 'unknown' })).toBe(
      'Your appointment is confirmed. - Acme'
    )
  })

  test('null appointmentDateTime same as omitted', () => {
    expect(
      buildConfirmationSms({
        businessName: 'Smile Dental',
        appointmentDateTime: null,
        vertical: 'dental',
      })
    ).toBe(
      'Your appointment with Smile Dental has been booked. We look forward to seeing you! Reply CANCEL to cancel.'
    )
  })

  test('whitespace-only contactName treated as no name', () => {
    expect(
      buildConfirmationSms({ contactName: '   ', businessName: 'Smile Dental', vertical: 'dental' })
    ).toBe(
      'Your appointment with Smile Dental has been booked. We look forward to seeing you! Reply CANCEL to cancel.'
    )
  })
})
