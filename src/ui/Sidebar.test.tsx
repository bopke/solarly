import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

function renderSidebar(defaultExpanded = true) {
  return render(
    <Sidebar
      mode="tmy"
      onModeChange={vi.fn()}
      onUpdate={vi.fn()}
      defaultExpanded={defaultExpanded}
    />,
  )
}

describe('Sidebar', () => {
  it('starts expanded by default, exposing its sections', () => {
    renderSidebar()
    const toggle = screen.getByRole('button', { name: /settings/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('radiogroup', { name: /mode/i })).toBeVisible()
  })

  it('collapses the content when the accordion toggle is clicked', () => {
    renderSidebar()
    const toggle = screen.getByRole('button', { name: /settings/i })

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const content = document.getElementById('sidebar-content')
    expect(content).not.toBeVisible()
  })

  it('expands again on a second click', () => {
    renderSidebar()
    const toggle = screen.getByRole('button', { name: /settings/i })

    fireEvent.click(toggle)
    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('sidebar-content')).toBeVisible()
  })

  it('honors defaultExpanded=false', () => {
    renderSidebar(false)
    expect(screen.getByRole('button', { name: /settings/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})
