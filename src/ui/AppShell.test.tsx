import { useState } from 'react'
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

  it('shows the empty state even while loading, when no location is set', () => {
    // Priority order is empty -> error -> loading -> content: an
    // in-flight run with no location yet should never show a spinner.
    render(<AppShell hasLocation={false} isLoading />)
    expect(screen.getByText(/no location selected/i)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the loading skeleton instead of tab content while loading', () => {
    render(
      <AppShell
        hasLocation
        isLoading
        tabContent={{ daily: <div>Daily chart goes here</div> }}
      />,
    )
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText(/no location selected/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/daily chart goes here/i)).not.toBeInTheDocument()
  })

  it('shows an error state instead of loading/content when error is set', () => {
    render(
      <AppShell
        hasLocation
        isLoading
        error={<span>Couldn&apos;t reach the climate API</span>}
        tabContent={{ daily: <div>Daily chart goes here</div> }}
      />,
    )
    expect(
      screen.getByText(/couldn't reach the climate api/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText(/daily chart goes here/i)).not.toBeInTheDocument()
  })

  it('shows the empty state, not the error, when no location is set', () => {
    render(<AppShell hasLocation={false} error={<span>Some error</span>} />)
    expect(screen.getByText(/no location selected/i)).toBeInTheDocument()
    expect(screen.queryByText(/some error/i)).not.toBeInTheDocument()
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

  it('falls back to a labeled placeholder for a tab with no tabContent entry', () => {
    // The partial-rollout guarantee siblings rely on: an unset tab gets a
    // placeholder, not a blank panel or a crash.
    render(
      <AppShell hasLocation tabContent={{ monthly: <div>Monthly</div> }} />,
    )
    expect(screen.getByText(/daily tab placeholder/i)).toBeInTheDocument()
  })

  it('disables the Update button via updateDisabled and does not fire onUpdate', () => {
    const onUpdate = vi.fn()
    render(<AppShell hasLocation onUpdate={onUpdate} updateDisabled />)

    const button = screen.getByRole('button', { name: 'Update' })
    expect(button).toBeDisabled()

    fireEvent.click(button)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('defaults to the forecast tab when defaultMode is live', () => {
    render(<AppShell hasLocation defaultMode="live" />)
    expect(screen.getByRole('tab', { name: 'Forecast' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'Live' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('passes the current mode and activeTab to onUpdate', () => {
    const onUpdate = vi.fn()
    render(<AppShell hasLocation onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Monthly' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    expect(onUpdate).toHaveBeenCalledWith({ mode: 'tmy', activeTab: 'monthly' })
  })

  it('does not throw when onUpdate is not provided', () => {
    render(<AppShell hasLocation />)
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Update' })),
    ).not.toThrow()
  })

  describe('controlled mode/activeTab', () => {
    function ControlledHarness() {
      const [mode, setMode] = useState<'tmy' | 'live'>('tmy')
      const [activeTab, setActiveTab] = useState<
        'daily' | 'monthly' | 'heatmap' | 'forecast'
      >('daily')
      return (
        <AppShell
          hasLocation
          mode={mode}
          onModeChange={setMode}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      )
    }

    it('lets a parent observe and drive mode/activeTab', () => {
      render(<ControlledHarness />)

      fireEvent.click(screen.getByRole('tab', { name: 'Monthly' }))
      expect(screen.getByRole('tab', { name: 'Monthly' })).toHaveAttribute(
        'aria-selected',
        'true',
      )

      fireEvent.click(screen.getByRole('radio', { name: 'Live' }))
      expect(screen.getByRole('radio', { name: 'Live' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      expect(screen.getByRole('tab', { name: 'Forecast' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })

    it('self-corrects when a controlled mode is changed externally, leaving activeTab uncontrolled and invalid for the new mode', () => {
      // Mirrors the URL-persistence pattern: parent controls `mode` (e.g.
      // via a router/back-button) but leaves `activeTab` uncontrolled. If
      // `mode` changes via any route other than the in-shell toggle (here,
      // a rerender with a new `mode` prop), the shell must still land on a
      // tab that's valid for the new mode.
      const { rerender } = render(<AppShell hasLocation mode="tmy" />)

      // Pick "Monthly" while still in tmy mode, so activeTab is left
      // pointing at a tab that doesn't exist in live mode.
      fireEvent.click(screen.getByRole('tab', { name: 'Monthly' }))
      expect(screen.getByRole('tab', { name: 'Monthly' })).toHaveAttribute(
        'aria-selected',
        'true',
      )

      // Parent flips `mode` directly (not via ModeToggle) with activeTab
      // still uncontrolled and stuck at 'monthly'.
      rerender(<AppShell hasLocation mode="live" />)

      const forecastTab = screen.getByRole('tab', { name: 'Forecast' })
      expect(forecastTab).toHaveAttribute('aria-selected', 'true')
      expect(forecastTab).toHaveAttribute('tabIndex', '0')

      // The tablist must stay keyboard-reachable: some tab has tabIndex 0.
      const tabs = screen.getAllByRole('tab')
      expect(tabs.some((tab) => tab.getAttribute('tabIndex') === '0')).toBe(
        true,
      )

      // The panel and its aria-labelledby must agree with the selected tab.
      const panel = screen.getByRole('tabpanel')
      const labelledBy = panel.getAttribute('aria-labelledby')
      expect(labelledBy).toBe(forecastTab.id)
    })
  })
})
