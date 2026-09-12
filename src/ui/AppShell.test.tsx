import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  it('shows the empty state when no location is set', () => {
    render(<AppShell hasLocation={false} />)
    expect(screen.getByText(/no location selected/i)).toBeInTheDocument()
    expect(
      screen.getByText(/search for an address or click the map/i),
    ).toBeInTheDocument()
  })

  it('shows the loading skeleton instead of tab content while loading', () => {
    render(<AppShell hasLocation isLoading />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText(/no location selected/i)).not.toBeInTheDocument()
  })

  it('shows tab content once a location is set and loading has finished', () => {
    render(
      <AppShell
        hasLocation
        tabContent={{ daily: <div>Daily chart goes here</div> }}
      />,
    )
    expect(screen.getByText(/daily chart goes here/i)).toBeInTheDocument()
  })

  it('shows Daily/Monthly/Heatmap tabs in TMY mode and Forecast only in Live mode', () => {
    render(<AppShell hasLocation />)

    const tablist = screen.getByRole('tablist')
    expect(
      within(tablist).getByRole('tab', { name: 'Daily' }),
    ).toBeInTheDocument()
    expect(
      within(tablist).getByRole('tab', { name: 'Monthly' }),
    ).toBeInTheDocument()
    expect(
      within(tablist).getByRole('tab', { name: 'Heatmap' }),
    ).toBeInTheDocument()
    expect(
      within(tablist).queryByRole('tab', { name: 'Forecast' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Live' }))

    const liveTablist = screen.getByRole('tablist')
    expect(
      within(liveTablist).getByRole('tab', { name: 'Forecast' }),
    ).toBeInTheDocument()
    expect(
      within(liveTablist).queryByRole('tab', { name: 'Daily' }),
    ).not.toBeInTheDocument()
    expect(
      within(liveTablist).queryByRole('tab', { name: 'Monthly' }),
    ).not.toBeInTheDocument()
    expect(
      within(liveTablist).queryByRole('tab', { name: 'Heatmap' }),
    ).not.toBeInTheDocument()
  })

  it('switches active tab content on click', () => {
    render(
      <AppShell
        hasLocation
        tabContent={{
          daily: <div>Daily content</div>,
          monthly: <div>Monthly content</div>,
        }}
      />,
    )

    expect(screen.getByText('Daily content')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Monthly' }))
    expect(screen.getByText('Monthly content')).toBeInTheDocument()
    expect(screen.queryByText('Daily content')).not.toBeInTheDocument()
  })

  it('resets to the first available tab when switching to a mode where the active tab is not visible', () => {
    render(<AppShell hasLocation />)

    fireEvent.click(screen.getByRole('tab', { name: 'Monthly' }))
    expect(screen.getByRole('tab', { name: 'Monthly' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Live' }))
    expect(screen.getByRole('tab', { name: 'Forecast' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    fireEvent.click(screen.getByRole('radio', { name: 'TMY' }))
    // Monthly is no longer selected after round-tripping through Live mode;
    // shell falls back to the first tab (Daily) rather than an invalid one.
    expect(screen.getByRole('tab', { name: 'Daily' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('calls onUpdate when the Update button is clicked', () => {
    const onUpdate = vi.fn()
    render(<AppShell hasLocation onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('renders placeholder slots for location and system config when none are provided', () => {
    render(<AppShell hasLocation={false} />)
    expect(screen.getByText(/location picker placeholder/i)).toBeInTheDocument()
    expect(
      screen.getByText(/system config form placeholder/i),
    ).toBeInTheDocument()
  })

  it('renders provided slot content instead of the placeholder', () => {
    render(
      <AppShell
        hasLocation={false}
        locationSlot={<div>Real location picker</div>}
        systemConfigSlot={<div>Real system config form</div>}
      />,
    )
    expect(screen.getByText('Real location picker')).toBeInTheDocument()
    expect(screen.getByText('Real system config form')).toBeInTheDocument()
    expect(
      screen.queryByText(/location picker placeholder/i),
    ).not.toBeInTheDocument()
  })
})
