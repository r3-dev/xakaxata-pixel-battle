//go:build dev

package ui

import (
	"text/template"
)

func init() {
	UiTemplates = &Template{
		templates: template.Must(template.ParseGlob("ui/src/**/*.html")),
	}
}
